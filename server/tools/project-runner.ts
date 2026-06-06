import "server-only";
import { spawn, type ChildProcess, execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createServer } from "node:net";
import type { RunContext } from "../orchestrator";

/** Find an available TCP port on localhost by binding to port 0. */
function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      if (addr && typeof addr === "object") {
        const { port } = addr;
        srv.close(() => resolve(port));
      } else {
        srv.close(() => reject(new Error("Could not determine a free port")));
      }
    });
  });
}

export class AppUnavailableError extends Error {}

type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

function detectPackageManager(projectPath: string): PackageManager {
  if (existsSync(join(projectPath, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(projectPath, "yarn.lock"))) return "yarn";
  if (existsSync(join(projectPath, "bun.lockb"))) return "bun";
  return "npm";
}

/** Only dev/start scripts may be auto-run — never arbitrary commands. */
const ALLOWED_SCRIPTS = new Set(["dev", "start"]);

async function healthCheck(url: string, signal: AbortSignal): Promise<boolean> {
  try {
    const res = await fetch(url, { signal, redirect: "manual" });
    // Any HTTP response (even 4xx/5xx) means the server process is alive.
    return res.status > 0;
  } catch {
    return false;
  }
}

async function waitForHealthy(
  url: string,
  signal: AbortSignal,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signal.aborted) return false;
    if (await healthCheck(url, signal)) return true;
    await new Promise((r) => setTimeout(r, 1000));
  }
  return false;
}

function parseUrlFromOutput(text: string): string | null {
  const m = text.match(/https?:\/\/(?:localhost|127\.0\.0\.1)(?::\d+)?/i);
  return m ? m[0] : null;
}

export class ProjectRunner {
  private child: ChildProcess | null = null;
  private crashed = false;
  private exitInfo: string | null = null;

  constructor(
    private projectPath: string,
    private ctx: RunContext,
  ) {}

  /**
   * Ensures the target app is reachable. Returns the base URL.
   * Throws AppUnavailableError (after recording a PROCESS finding) if it cannot run.
   */
  async ensureRunning(opts: {
    mode: "auto-start" | "url";
    url?: string;
    script?: string;
  }): Promise<string> {
    if (opts.mode === "url") return this.useExistingUrl(opts.url);
    return this.autoStart(opts.script ?? "dev");
  }

  private async useExistingUrl(url?: string): Promise<string> {
    if (!url) throw new AppUnavailableError("URL mode selected but no URL provided.");
    this.ctx.step(`Checking provided URL: ${url}`);
    const ok = await waitForHealthy(url, this.ctx.signal, 15000);
    if (!ok) {
      this.ctx.finding({
        category: "PROCESS",
        severity: "critical",
        title: "App not reachable at provided URL",
        detail: `No HTTP response from ${url} within 15s. Is the dev server running?`,
        suggestion: "Start the project (e.g. `npm run dev`) before running the wizard, or use auto-start mode.",
      });
      throw new AppUnavailableError(`App unreachable at ${url}`);
    }
    this.ctx.step(`App is reachable at ${url}`);
    return url;
  }

  private async autoStart(script: string): Promise<string> {
    if (!ALLOWED_SCRIPTS.has(script)) {
      throw new AppUnavailableError(`Script "${script}" is not allowed (only dev/start).`);
    }
    const pm = detectPackageManager(this.projectPath);
    // Assign a dedicated free port and isolate the child's environment so the
    // wizard server's own PORT / NODE_ENV are never inherited (which would make
    // the target app try to bind the wizard's port → EADDRINUSE crash).
    const port = await findFreePort();
    const expectedUrl = `http://localhost:${port}`;
    this.ctx.step(`Auto-starting app: ${pm} run ${script}`, { pm, script, port });

    let detectedUrl: string | null = null;
    const logChunks: string[] = [];

    // Strip the wizard's own PORT/NODE_ENV; let the target's dev script pick its mode.
    const { PORT: _ignoredPort, NODE_ENV: _ignoredEnv, ...inheritedEnv } = process.env;
    const childEnv: Record<string, string | undefined> = {
      ...inheritedEnv,
      BROWSER: "none",
      FORCE_COLOR: "0",
      PORT: String(port),
    };

    this.child = spawn(pm, ["run", script], {
      cwd: this.projectPath,
      shell: true,
      env: childEnv as NodeJS.ProcessEnv,
    });

    const onData = (buf: Buffer) => {
      const text = buf.toString();
      logChunks.push(text);
      if (!detectedUrl) detectedUrl = parseUrlFromOutput(text);
    };
    this.child.stdout?.on("data", onData);
    this.child.stderr?.on("data", onData);

    this.child.on("exit", (code) => {
      if (code !== 0 && code !== null) {
        this.crashed = true;
        this.exitInfo = `Dev server exited with code ${code}`;
      }
    });

    // Give the server a moment to announce its URL, then fall back to :3000.
    const startDeadline = Date.now() + 45000;
    while (Date.now() < startDeadline) {
      if (this.ctx.signal.aborted) throw new AppUnavailableError("Cancelled");
      if (this.crashed) break;
      if (detectedUrl && (await healthCheck(detectedUrl, this.ctx.signal))) break;
      await new Promise((r) => setTimeout(r, 1000));
    }

    const logPath = this.ctx.log(logChunks.join(""), "dev-server");

    if (this.crashed) {
      this.ctx.finding({
        category: "PROCESS",
        severity: "critical",
        title: "App crashed on startup",
        detail: `${this.exitInfo}. See dev-server log for details.`,
        suggestion: "Fix the startup error reported in the dev server output.",
      });
      throw new AppUnavailableError(this.exitInfo ?? "Dev server crashed");
    }

    const baseUrl = detectedUrl ?? expectedUrl;
    const healthy = await waitForHealthy(baseUrl, this.ctx.signal, 20000);
    if (!healthy) {
      this.ctx.finding({
        category: "PROCESS",
        severity: "critical",
        title: "App did not become reachable",
        detail: `Started ${pm} run ${script} but ${baseUrl} never responded. Log: ${logPath}`,
        suggestion: "Verify the project starts cleanly with the dev script.",
      });
      throw new AppUnavailableError(`App not reachable at ${baseUrl}`);
    }
    this.ctx.step(`App is up at ${baseUrl}`);
    return baseUrl;
  }

  /** Whether the dev server has crashed since startup (for later health reporting). */
  hasCrashed(): boolean {
    return this.crashed;
  }

  stop(): void {
    if (!this.child || this.child.pid === undefined) return;
    const pid = this.child.pid;
    try {
      if (process.platform === "win32") {
        // PID-based tree kill so child node processes are also terminated.
        execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" });
      } else {
        process.kill(-pid, "SIGTERM");
      }
    } catch {
      try {
        this.child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
    }
    this.child = null;
  }
}
