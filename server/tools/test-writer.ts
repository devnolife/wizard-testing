import "server-only";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve, sep, basename } from "node:path";
import { execFile } from "node:child_process";
import { writeGeneratedTest } from "../store/artifacts";
import type { RunContext } from "../orchestrator";

const DEFAULT_SAVE_DIR = "tests/wizard";

export function safeFilename(name: string): string {
  const base = basename(name);
  if (!/^[a-z0-9._-]+$/i.test(base)) {
    throw new Error("Invalid test filename.");
  }
  if (!/\.(spec|test)\.(t|j)sx?$/.test(base)) {
    return base.replace(/\.(t|j)sx?$/, "") + ".spec.ts";
  }
  return base;
}

export interface WriteTestResult {
  savedTo: "project" | "ephemeral";
  path: string;
  note?: string;
}

/**
 * Persists a generated test. Always keeps an ephemeral copy in the run artifacts;
 * only writes into the target project when the run opted in (saveMode === "project").
 */
export function writeTest(
  ctx: RunContext,
  input: { filename: string; content: string; target?: "project" | "ephemeral" },
): WriteTestResult {
  const filename = safeFilename(input.filename);
  const ephemeralPath = writeGeneratedTest(ctx.run.id, filename, input.content);

  const wantsProject = (input.target ?? ctx.run.saveMode) === "project";
  if (!wantsProject || ctx.run.saveMode !== "project") {
    return {
      savedTo: "ephemeral",
      path: ephemeralPath,
      note:
        ctx.run.saveMode !== "project" && input.target === "project"
          ? "Run is not in save-to-project mode; saved ephemerally instead."
          : undefined,
    };
  }

  const base = resolve(ctx.run.projectPath);
  const saveDir = ctx.run.saveDir || DEFAULT_SAVE_DIR;
  const dir = resolve(base, saveDir);
  if (dir !== base && !dir.startsWith(base + sep)) {
    throw new Error("Save directory is outside the project.");
  }
  mkdirSync(dir, { recursive: true });
  const projectPath = join(dir, filename);
  writeFileSync(projectPath, input.content, "utf8");
  ctx.tool("test-writer", `Saved test to project: ${saveDir}/${filename}`);
  return { savedTo: "project", path: projectPath };
}

export interface PlaywrightSummary {
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
}

/**
 * Parse the counts from Playwright's line/list reporter summary. Playwright
 * itself does the retry bookkeeping: with `--retries=N`, a spec that fails then
 * passes on a retry is reported as "flaky". We just read those totals.
 */
export function parsePlaywrightSummary(output: string): PlaywrightSummary {
  const count = (re: RegExp): number => {
    const m = output.match(re);
    return m ? parseInt(m[1], 10) : 0;
  };
  return {
    passed: count(/(\d+)\s+passed/),
    failed: count(/(\d+)\s+failed/),
    flaky: count(/(\d+)\s+flaky/),
    skipped: count(/(\d+)\s+skipped/),
  };
}

export interface RunTestsResult {
  exitCode: number | null;
  output: string;
  timedOut: boolean;
  retries: number;
  summary: PlaywrightSummary;
  /** True when Playwright reported one or more flaky specs (passed only on retry). */
  flaky: boolean;
}

/** Runs Playwright tests in the target project (best-effort, allowlisted command). */
export function runTests(
  ctx: RunContext,
  input: { file?: string; retries?: number },
): Promise<RunTestsResult> {
  return new Promise((resolvePromise) => {
    // Cap retries to a sane range; default 2 so Playwright can surface flakiness.
    const retries = Math.max(0, Math.min(input.retries ?? 2, 5));
    const args = ["playwright", "test", "--reporter=line", `--retries=${retries}`];
    if (input.file) args.push(input.file);
    ctx.tool("test-writer", `Running tests: npx ${args.join(" ")}`);

    const child = execFile(
      "npx",
      args,
      {
        cwd: ctx.run.projectPath,
        timeout: 120000,
        maxBuffer: 4 * 1024 * 1024,
        shell: true,
        env: { ...process.env, FORCE_COLOR: "0", CI: "1" },
      },
      (err, stdout, stderr) => {
        const output = `${stdout ?? ""}\n${stderr ?? ""}`.trim();
        const timedOut = !!(err && (err as NodeJS.ErrnoException).code === "ETIMEDOUT");
        const exitCode =
          err && typeof (err as unknown as { code?: number }).code === "number"
            ? ((err as unknown as { code: number }).code as number)
            : err
              ? 1
              : 0;
        const summary = parsePlaywrightSummary(output);
        ctx.log(output, "playwright-run");
        if (summary.flaky > 0) {
          ctx.tool("test-writer", `Detected ${summary.flaky} flaky spec(s) (passed only on retry)`);
        }
        resolvePromise({
          exitCode: timedOut ? null : exitCode,
          output,
          timedOut,
          retries,
          summary,
          flaky: summary.flaky > 0,
        });
      },
    );
    ctx.signal.addEventListener("abort", () => child.kill(), { once: true });
  });
}
