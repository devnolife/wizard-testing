import "server-only";
import type { RunContext } from "../orchestrator";
import type { Run, RunStatus } from "@/lib/types";
import { listFindings } from "../store/db";
import { ProjectRunner, AppUnavailableError } from "../tools/project-runner";
import { BrowserController } from "../tools/browser";
import { readTestingGuide, type TestingGuide } from "../tools/guide";
import { sessionStatePath, hasFreshSession } from "../store/baselines";
import { buildTools } from "./tools";
import { createCopilotSession, disposeCopilot, type CopilotHandle } from "./session";

const AGENT_TIMEOUT_MS = 1000 * 60 * 15; // 15 minutes hard cap per run.

function activeScopes(run: Run): string[] {
  const s: string[] = [];
  if (run.scope.ui) s.push("UI correctness (pages render, navigation, flows work)");
  if (run.scope.ux)
    s.push(
      "UX quality (end-to-end flows complete without dead-ends; accessibility: alt text, labels, keyboard, lang, contrast; usability heuristics: clear errors, feedback)",
    );
  if (run.scope.api) s.push("API correctness (status codes, payloads, error handling)");
  return s;
}

function buildPrompt(run: Run, baseUrl: string, guide: TestingGuide | null): string {
  const scopes = activeScopes(run);
  const saveNote =
    run.saveMode === "project"
      ? `When you write tests with write_test, set target "project" to save reusable Playwright specs into the project (folder: ${run.saveDir || "tests/wizard"}).`
      : `Write tests with write_test using target "ephemeral" (they are kept as run artifacts, not added to the project).`;

  const guideSection = guide
    ? [
        ``,
        `Project testing guide (provided by the project author in ${guide.relPath}).`,
        `Treat this as authoritative context — use the test accounts/credentials, feature list,`,
        `and flows below instead of guessing. Do not report the guide's own contents as a finding.`,
        `--- BEGIN GUIDE ---`,
        guide.content,
        `--- END GUIDE ---${guide.truncated ? "\n(guide was truncated)" : ""}`,
      ]
    : [];

  const authSection =
    run.auth
      ? [
          ``,
          `Authentication: the wizard has already logged in at ${run.auth.loginPath} as "${run.auth.username}" before you started,`,
          `so the browser session is authenticated. If you get logged out or need to re-authenticate, call browser_login.`,
        ]
      : [];

  return [
    `You are an autonomous QA engineer testing a running full-stack Next.js app at ${baseUrl}.`,
    `The project source is your working directory.`,
    ...guideSection,
    ...authSection,
    ``,
    `Test scope for this run:`,
    ...scopes.map((s) => `- ${s}`),
    ``,
    `How to work:`,
    `1. Call discover_app to list pages and API routes. Use read_file to understand key pages/handlers.`,
    `2. For UI/UX: use browser_goto, browser_click, browser_fill, and browser_snapshot to explore real user flows. Inspect snapshot accessibility numbers and console/page errors.`,
    `3. For accessibility & performance: call audit_page on important pages to get axe-core WCAG violations and load metrics, and report the significant ones.`,
    `4. For visual stability: call visual_check (with the route as label) on key pages — it creates a baseline the first time and flags pixel regressions on later runs.`,
    `5. For API: use http_request against the API routes; check status codes and error handling.`,
    `6. Whenever you find a problem OR confirm something important, call report_finding with an accurate category and severity. Use captureScreenshot for UI/UX issues.`,
    `7. Generate test coverage with write_test for the meaningful flows you exercised. ${saveNote}`,
    `8. Run the specs with run_tests. It retries failing specs, so if it reports flaky > 0, report a PROCESS/minor finding naming the flaky spec(s); if specs fail outright, report the failure.`,
    ``,
    `Rules: Do not ask the user questions — act autonomously. Only interact with the app via the provided tools. Be thorough but efficient. When finished, summarize what you tested and the key findings.`,
  ].join("\n");
}

function deriveStatus(runId: string): {
  status: Extract<RunStatus, "passed" | "failed">;
  summary: string;
} {
  const findings = listFindings(runId);
  const counts = { critical: 0, major: 0, minor: 0, info: 0 } as Record<string, number>;
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  const failed = counts.critical > 0 || counts.major > 0;
  const summary =
    `${findings.length} finding(s): ` +
    `${counts.critical} critical, ${counts.major} major, ${counts.minor} minor, ${counts.info} info.`;
  return { status: failed ? "failed" : "passed", summary };
}

export async function runPipeline(
  ctx: RunContext,
): Promise<{ status: Extract<RunStatus, "passed" | "failed" | "error">; summary: string }> {
  const { run } = ctx;
  const runner = new ProjectRunner(run.projectPath, ctx);
  let browser: BrowserController | null = null;
  let copilot: CopilotHandle | null = null;

  try {
    ctx.step("Ensuring the target app is running");
    const baseUrl = await runner.ensureRunning({ mode: run.mode, url: run.url });

    browser = new BrowserController(baseUrl, {
      headed: run.headed || process.env.WIZARD_HEADED === "1",
      storageStatePath: run.auth ? sessionStatePath(run.projectPath) : undefined,
    });
    if (run.headed || process.env.WIZARD_HEADED === "1") {
      ctx.step("Browser runs in a visible window (headed mode)");
    }
    const tools = buildTools({ ctx, baseUrl, browser, projectPath: run.projectPath });

    ctx.step("Starting Copilot agent");
    copilot = await createCopilotSession({ workingDirectory: run.projectPath, tools });

    const guide = readTestingGuide(run.projectPath);
    if (guide) {
      ctx.step(`Loaded testing guide from ${guide.relPath}`, { path: guide.relPath });
    } else {
      ctx.step("No testing guide found (add wizard.md to give the agent test accounts & feature context)");
    }

    copilot.session.on("assistant.message", (event) => {
      const content = (event as { data?: { content?: string } }).data?.content;
      if (content) ctx.emit("log", content.slice(0, 4000), { source: "agent" });
      // The SDK reports per-message completion tokens via data.outputTokens.
      const outputTokens = (event as { data?: { outputTokens?: number } }).data?.outputTokens;
      if (outputTokens) ctx.addTokens(outputTokens);
    });

    if (run.auth) {
      const statePath = sessionStatePath(run.projectPath);
      if (hasFreshSession(run.projectPath)) {
        ctx.step("Reused saved login session (skipping login)");
      } else {
        ctx.step(`Logging in via ${run.auth.loginPath}`);
        try {
          const res = await browser.login(run.auth);
          if (res.ok) {
            ctx.step(`Logged in — now at ${res.url}`);
            await browser.saveStorageState(statePath);
          } else {
            ctx.emit("log", `Auto-login failed: ${res.detail ?? "unknown"}`, { source: "auth" });
          }
        } catch (e) {
          ctx.emit("log", `Auto-login error: ${e instanceof Error ? e.message : String(e)}`, {
            source: "auth",
          });
        }
      }
    }

    ctx.step("Agent is exploring and testing the app");
    const prompt = buildPrompt(run, baseUrl, guide);

    // Live screencast: stream a viewport frame on a timer so the dashboard's
    // "Live browser view" updates continuously, not just on discrete actions.
    let capturing = false;
    const screencast = setInterval(() => {
      if (capturing || !browser || !browser.hasPage()) return;
      capturing = true;
      browser
        .liveSnapshot()
        .then((frame) => {
          if (frame) ctx.liveFrame(frame);
        })
        .catch(() => {})
        .finally(() => {
          capturing = false;
        });
    }, 1500);

    try {
      await copilot.session.sendAndWait(prompt, AGENT_TIMEOUT_MS);
    } finally {
      clearInterval(screencast);
    }

    if (ctx.signal.aborted) return { status: "error", summary: "Run cancelled." };

    const result = deriveStatus(run.id);
    ctx.step("Analysis complete");
    return result;
  } catch (err) {
    if (err instanceof AppUnavailableError) {
      // Finding already recorded by the runner; report as a failed run.
      return {
        status: "failed",
        summary: `App could not be tested: ${err.message}`,
      };
    }
    throw err;
  } finally {
    await disposeCopilot(copilot);
    if (browser) await browser.close();
    runner.stop();
  }
}
