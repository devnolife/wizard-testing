import "server-only";
import { defineTool, type Tool } from "@github/copilot-sdk";
import type { RunContext } from "../orchestrator";
import type { BrowserController } from "../tools/browser";
import { apiRequest } from "../tools/http";
import { discoverApp, readProjectFile } from "../tools/codebase";
import { writeTest, runTests } from "../tools/test-writer";
import type { FindingCategory, Severity } from "@/lib/types";

export interface ToolEnv {
  ctx: RunContext;
  baseUrl: string;
  browser: BrowserController;
  projectPath: string;
}

function ok(data: unknown): string {
  return JSON.stringify(data);
}
function fail(message: string): string {
  return JSON.stringify({ error: message });
}

const CATEGORIES: FindingCategory[] = ["UI", "UX", "API", "PROCESS"];
const SEVERITIES: Severity[] = ["critical", "major", "minor", "info"];

export function buildTools(env: ToolEnv): Tool[] {
  const { ctx, browser } = env;

  return ([
    defineTool("discover_app", {
      description:
        "Scan the target Next.js project and list its pages (UI routes) and API routes. Call this first to plan what to test.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      handler: () => {
        try {
          const map = discoverApp(env.projectPath);
          ctx.tool("discover_app", `Found ${map.pages.length} pages, ${map.apiRoutes.length} API routes`);
          return ok(map);
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    }),

    defineTool("read_file", {
      description:
        "Read a source file inside the target project (relative path). Use to understand a page, component, or API handler before testing it.",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Path relative to the project root." } },
        required: ["path"],
        additionalProperties: false,
      },
      handler: (args: { path: string }) => {
        try {
          const res = readProjectFile(env.projectPath, args.path);
          return ok(res);
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    }),

    defineTool("http_request", {
      description:
        "Send an HTTP request to an API route of the running app (localhost only). Use to test API correctness, status codes, and error handling.",
      parameters: {
        type: "object",
        properties: {
          method: { type: "string", enum: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"] },
          path: { type: "string", description: "Path or URL, e.g. /api/users" },
          headers: { type: "object", additionalProperties: { type: "string" } },
          body: { description: "Request body (object or string)." },
        },
        required: ["path"],
        additionalProperties: false,
      },
      handler: async (args: { method?: string; path: string; headers?: Record<string, string>; body?: unknown }) => {
        const res = await apiRequest(env.baseUrl, args, ctx.signal);
        ctx.tool("http_request", `${args.method ?? "GET"} ${args.path} -> ${res.status}`, {
          status: res.status,
          latencyMs: res.latencyMs,
        });
        return ok(res);
      },
    }),

    defineTool("browser_goto", {
      description: "Navigate the browser to a path of the running app (e.g. / or /login).",
      parameters: {
        type: "object",
        properties: { path: { type: "string" } },
        required: ["path"],
        additionalProperties: false,
      },
      handler: async (args: { path: string }) => {
        try {
          const res = await browser.goto(args.path);
          ctx.tool("browser_goto", `Navigated to ${res.url} (status ${res.status ?? "?"})`);
          return ok(res);
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    }),

    defineTool("browser_click", {
      description: "Click an element by CSS selector or by visible text.",
      parameters: {
        type: "object",
        properties: { selector: { type: "string" }, text: { type: "string" } },
        additionalProperties: false,
      },
      handler: async (args: { selector?: string; text?: string }) => {
        try {
          await browser.click(args);
          ctx.tool("browser_click", `Clicked ${args.selector ?? args.text}`);
          return ok({ clicked: true });
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    }),

    defineTool("browser_fill", {
      description: "Fill a form input identified by CSS selector with a value.",
      parameters: {
        type: "object",
        properties: { selector: { type: "string" }, value: { type: "string" } },
        required: ["selector", "value"],
        additionalProperties: false,
      },
      handler: async (args: { selector: string; value: string }) => {
        try {
          await browser.fill(args.selector, args.value);
          ctx.tool("browser_fill", `Filled ${args.selector}`);
          return ok({ filled: true });
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    }),

    defineTool("browser_snapshot", {
      description:
        "Capture the current page: title, headings, accessibility checks (missing alt/labels/names, lang, title), console/page errors, plus a screenshot. Use to evaluate UI and UX.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      handler: async () => {
        try {
          const snap = await browser.snapshot();
          const shot = await browser.screenshot();
          const path = ctx.screenshot(shot, "snapshot");
          ctx.tool("browser_snapshot", `Snapshot of ${snap.url}`);
          return ok({ ...snap, screenshotPath: path });
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    }),

    defineTool("report_finding", {
      description:
        "Record a test finding (a bug, UX issue, accessibility problem, or note). Call this whenever you observe something worth reporting.",
      parameters: {
        type: "object",
        properties: {
          category: { type: "string", enum: CATEGORIES },
          severity: { type: "string", enum: SEVERITIES },
          title: { type: "string" },
          detail: { type: "string" },
          suggestion: { type: "string" },
          captureScreenshot: { type: "boolean", description: "Attach a screenshot of the current page." },
        },
        required: ["category", "severity", "title", "detail"],
        additionalProperties: false,
      },
      handler: async (args: {
        category: FindingCategory;
        severity: Severity;
        title: string;
        detail: string;
        suggestion?: string;
        captureScreenshot?: boolean;
      }) => {
        let screenshot: Buffer | null = null;
        if (args.captureScreenshot) {
          try {
            screenshot = await browser.screenshot();
          } catch {
            screenshot = null;
          }
        }
        ctx.finding({
          category: args.category,
          severity: args.severity,
          title: args.title,
          detail: args.detail,
          suggestion: args.suggestion ?? null,
          screenshot,
        });
        return ok({ recorded: true });
      },
    }),

    defineTool("write_test", {
      description:
        "Write a generated test file (e.g. a Playwright spec). Always kept as a run artifact; saved into the project only when the run opted into save-to-project mode.",
      parameters: {
        type: "object",
        properties: {
          filename: { type: "string", description: "e.g. login.spec.ts" },
          content: { type: "string" },
          target: { type: "string", enum: ["project", "ephemeral"] },
        },
        required: ["filename", "content"],
        additionalProperties: false,
      },
      handler: (args: { filename: string; content: string; target?: "project" | "ephemeral" }) => {
        try {
          const res = writeTest(ctx, args);
          return ok(res);
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    }),

    defineTool("run_tests", {
      description:
        "Run Playwright tests in the target project (best-effort). Returns exit code and output for you to analyze.",
      parameters: {
        type: "object",
        properties: { file: { type: "string", description: "Optional specific test file to run." } },
        additionalProperties: false,
      },
      handler: async (args: { file?: string }) => {
        try {
          const res = await runTests(ctx, args);
          return ok(res);
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    }),
  ]) as unknown as Tool[];
}

/** Names of all custom tools — used to restrict the session to only these. */
export const TOOL_NAMES = [
  "discover_app",
  "read_file",
  "http_request",
  "browser_goto",
  "browser_click",
  "browser_fill",
  "browser_snapshot",
  "report_finding",
  "write_test",
  "run_tests",
];
