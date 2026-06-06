import "server-only";
import type { RunContext } from "../orchestrator";
import type { Run, RunStatus } from "@/lib/types";
import { listFindings } from "../store/db";
import { ProjectRunner, AppUnavailableError } from "../tools/project-runner";
import { BrowserController } from "../tools/browser";
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

function buildPrompt(run: Run, baseUrl: string): string {
  const scopes = activeScopes(run);
  const saveNote =
    run.saveMode === "project"
      ? `When you write tests with write_test, set target "project" to save reusable Playwright specs into the project (folder: ${run.saveDir || "tests/wizard"}).`
      : `Write tests with write_test using target "ephemeral" (they are kept as run artifacts, not added to the project).`;

  return [
    `You are an autonomous QA engineer testing a running full-stack Next.js app at ${baseUrl}.`,
    `The project source is your working directory.`,
    ``,
    `Test scope for this run:`,
    ...scopes.map((s) => `- ${s}`),
    ``,
    `How to work:`,
    `1. Call discover_app to list pages and API routes. Use read_file to understand key pages/handlers.`,
    `2. For UI/UX: use browser_goto, browser_click, browser_fill, and browser_snapshot to explore real user flows. Inspect snapshot accessibility numbers and console/page errors.`,
    `3. For API: use http_request against the API routes; check status codes and error handling.`,
    `4. Whenever you find a problem OR confirm something important, call report_finding with an accurate category and severity. Use captureScreenshot for UI/UX issues.`,
    `5. Generate test coverage with write_test for the meaningful flows you exercised. ${saveNote}`,
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

    browser = new BrowserController(baseUrl);
    const tools = buildTools({ ctx, baseUrl, browser, projectPath: run.projectPath });

    ctx.step("Starting Copilot agent");
    copilot = await createCopilotSession({ workingDirectory: run.projectPath, tools });

    copilot.session.on("assistant.message", (event) => {
      const content = (event as { data?: { content?: string } }).data?.content;
      if (content) ctx.emit("log", content.slice(0, 4000), { source: "agent" });
      // The SDK reports per-message completion tokens via data.outputTokens.
      const outputTokens = (event as { data?: { outputTokens?: number } }).data?.outputTokens;
      if (outputTokens) ctx.addTokens(outputTokens);
    });

    ctx.step("Agent is exploring and testing the app");
    const prompt = buildPrompt(run, baseUrl);
    await copilot.session.sendAndWait(prompt, AGENT_TIMEOUT_MS);

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
