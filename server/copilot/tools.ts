import "server-only";
import { defineTool, type Tool } from "@github/copilot-sdk";
import type { RunContext } from "../orchestrator";
import type { BrowserController } from "../tools/browser";
import { apiRequest } from "../tools/http";
import { discoverApp, readProjectFile } from "../tools/codebase";
import { writeTest, runTests } from "../tools/test-writer";
import {
  hasBaseline,
  readBaseline,
  saveBaseline,
  routeKey,
} from "../store/baselines";
import { diffPng } from "../report/visual";
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

  // Capture the current browser frame and stream it to the dashboard as a
  // "screencast" event, so users see the interaction live inside the app.
  const streamFrame = async (label: string) => {
    try {
      const shot = await browser.screenshot();
      ctx.screenshot(shot, label);
    } catch {
      /* screenshot is best-effort; never fail the action because of it */
    }
  };

  return ([
    defineTool("discover_app", {
      description:
        "Scan the target project and list its framework, pages (UI routes) and API routes. Works for Next.js, SvelteKit, Remix, Astro and Nuxt. Call this first to plan what to test. If it returns a `note` (e.g. for a client-rendered SPA), navigate to \"/\" and use list_links to discover routes.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      handler: () => {
        try {
          const map = discoverApp(env.projectPath);
          ctx.tool(
            "discover_app",
            `Detected ${map.framework}: ${map.pages.length} pages, ${map.apiRoutes.length} API routes`,
          );
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
          await streamFrame(`Opened ${args.path}`);
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
          await streamFrame(`Clicked ${args.selector ?? args.text}`);
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
          await streamFrame(`Typed into ${args.selector}`);
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

    defineTool("list_links", {
      description:
        "List same-origin internal link paths on the current page. Use to discover routes dynamically when discover_app couldn't map them statically (e.g. a client-rendered SPA): navigate to \"/\" first, then call this.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      handler: async () => {
        try {
          const links = await browser.listLinks();
          ctx.tool("list_links", `Found ${links.length} internal link(s)`);
          return ok({ links });
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    }),

    defineTool("browser_login", {
      description:
        "Authenticate against the app. Uses the run's configured credentials by default; you may override the login path/username/password (e.g. from the testing guide). Form fields are auto-detected. Call before testing pages that require a logged-in session.",
      parameters: {
        type: "object",
        properties: {
          loginPath: { type: "string", description: "e.g. /login" },
          username: { type: "string" },
          password: { type: "string" },
        },
        additionalProperties: false,
      },
      handler: async (args: { loginPath?: string; username?: string; password?: string }) => {
        const cfg = ctx.run.auth;
        const auth = {
          loginPath: args.loginPath ?? cfg?.loginPath,
          username: args.username ?? cfg?.username,
          password: args.password ?? cfg?.password,
          usernameSelector: cfg?.usernameSelector,
          passwordSelector: cfg?.passwordSelector,
          submitSelector: cfg?.submitSelector,
        };
        if (!auth.loginPath || !auth.username || !auth.password) {
          return fail("No credentials available. Provide loginPath, username and password.");
        }
        try {
          const res = await browser.login(auth as Parameters<typeof browser.login>[0]);
          ctx.tool("browser_login", res.ok ? `Logged in (now at ${res.url})` : `Login failed: ${res.detail ?? "unknown"}`);
          await streamFrame(res.ok ? "Logged in" : "Login attempt");
          return ok(res);
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    }),

    defineTool("audit_page", {
      description:
        "Run an accessibility (axe-core WCAG 2 A/AA) and performance audit on the current page. Returns a11y violations grouped by impact plus load timing metrics. Use to back up UX/accessibility and performance findings with hard data, then call report_finding for the important ones.",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      handler: async () => {
        try {
          const [a11y, perf] = await Promise.all([browser.axeAudit(), browser.perfMetrics()]);
          ctx.tool(
            "audit_page",
            `Audited ${a11y.url}: ${a11y.violationCount} a11y violation(s), load ${perf.loadComplete}ms`,
            { violations: a11y.violationCount, loadMs: perf.loadComplete },
          );
          return ok({ a11y, performance: perf });
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    }),

    defineTool("lighthouse_audit", {
      description:
        "Run a full Google Lighthouse audit on a page and return category scores (0–100) for performance, accessibility, best-practices and SEO, plus Core Web Vitals (FCP, LCP, TBT, CLS, Speed Index). Heavier than audit_page — use it once or twice on the most important page(s) to get authoritative scores. If a category scores low (e.g. performance < 80 or accessibility < 90), report a finding (category PERF or UX) citing the score and the worst metric. Resolves with { available: false } if Lighthouse/Chrome can't run — in that case fall back to audit_page.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Path to audit (e.g. \"/\" or \"/dashboard\"). Defaults to \"/\".",
          },
        },
        additionalProperties: false,
      },
      handler: async (args: { path?: string }) => {
        try {
          const res = await browser.lighthouseAudit(args.path ?? "/");
          if (res.available && res.scores) {
            const s = res.scores;
            ctx.tool(
              "lighthouse_audit",
              `Lighthouse ${res.url}: perf ${s.performance ?? "-"}, a11y ${s.accessibility ?? "-"}, best-practices ${s.bestPractices ?? "-"}, seo ${s.seo ?? "-"}`,
              { scores: s },
            );
          } else {
            ctx.tool(
              "lighthouse_audit",
              `Lighthouse unavailable for ${res.url}: ${res.reason ?? "unknown"}`,
            );
          }
          return ok(res);
        } catch (e) {
          return fail(e instanceof Error ? e.message : String(e));
        }
      },
    }),

    defineTool("visual_check", {
      description:
        "Visual regression check for the current page. On first run for a route it saves a baseline screenshot; on later runs it compares against that baseline and reports the pixel mismatch ratio (with a diff image). Use after navigating to a page whose appearance should stay stable. Pass a stable `label` (e.g. the route path) to identify the baseline.",
      parameters: {
        type: "object",
        properties: {
          label: { type: "string", description: "Stable id for the page, e.g. /login" },
        },
        additionalProperties: false,
      },
      handler: async (args: { label?: string }) => {
        try {
          const key = routeKey(args.label ?? "page");
          const current = await browser.fullScreenshot();
          if (!hasBaseline(env.projectPath, key)) {
            saveBaseline(env.projectPath, key, current);
            ctx.screenshot(current, `baseline-${key}`);
            ctx.tool("visual_check", `Saved visual baseline for "${key}"`);
            return ok({ baseline: "created", key });
          }
          const baseline = readBaseline(env.projectPath, key);
          const diff = diffPng(baseline, current);
          const changed = diff.mismatchRatio > 0.01 || diff.dimensionMismatch;
          ctx.screenshot(current, `visual-${key}`);
          let diffPath: string | null = null;
          if (changed && !diff.dimensionMismatch && diff.diffPng.length > 0) {
            diffPath = ctx.screenshot(diff.diffPng, `visual-diff-${key}`);
          }
          ctx.tool(
            "visual_check",
            `Visual diff for "${key}": ${(diff.mismatchRatio * 100).toFixed(2)}% changed${diff.dimensionMismatch ? " (size changed)" : ""}`,
            { mismatchRatio: diff.mismatchRatio, changed },
          );
          return ok({
            key,
            changed,
            dimensionMismatch: diff.dimensionMismatch,
            mismatchRatio: diff.mismatchRatio,
            diffPixels: diff.diffPixels,
            diffPath,
          });
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
        "Run Playwright tests in the target project (best-effort). Retries failing specs (default 2) so flaky tests — ones that pass only on retry — are detected. Returns exit code, output, and counts { passed, failed, flaky, skipped }. If flaky > 0, report a PROCESS/minor finding for the flaky spec(s).",
      parameters: {
        type: "object",
        properties: {
          file: { type: "string", description: "Optional specific test file to run." },
          retries: {
            type: "number",
            description: "How many times to retry a failing spec (0-5, default 2). Flaky tests pass within these retries.",
          },
        },
        additionalProperties: false,
      },
      handler: async (args: { file?: string; retries?: number }) => {
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
  "list_links",
  "browser_login",
  "audit_page",
  "lighthouse_audit",
  "visual_check",
  "report_finding",
  "write_test",
  "run_tests",
];
