import "server-only";
import { chromium, type Browser, type BrowserContext, type Page } from "playwright";
import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { AuthConfig } from "@/lib/types";

/**
 * Load the axe-core source from disk lazily. Reading the file directly (rather
 * than importing axe-core's `source` field) sidesteps bundler interop issues
 * that can drop the property in the Next.js server bundle.
 */
let cachedAxeSource: string | null = null;
function getAxeSource(): string {
  if (cachedAxeSource) return cachedAxeSource;
  // Strategy 1: resolve via the module system (works in plain Node/ESM).
  try {
    const req = createRequire(import.meta.url);
    cachedAxeSource = readFileSync(req.resolve("axe-core/axe.min.js"), "utf8");
    return cachedAxeSource;
  } catch {
    /* fall through */
  }
  // Strategy 2: read straight from node_modules relative to the wizard's cwd.
  // This survives bundlers that rewrite import.meta.url / createRequire.
  cachedAxeSource = readFileSync(
    join(process.cwd(), "node_modules", "axe-core", "axe.min.js"),
    "utf8",
  );
  return cachedAxeSource;
}

export interface A11yChecks {
  imagesMissingAlt: number;
  inputsMissingLabel: number;
  buttonsMissingName: number;
  documentHasTitle: boolean;
  htmlHasLang: boolean;
}

export interface AxeViolation {
  id: string;
  impact: string | null;
  help: string;
  helpUrl: string;
  nodes: number;
  sampleTarget: string | null;
}

export interface AxeResult {
  url: string;
  violations: AxeViolation[];
  violationCount: number;
  byImpact: Record<string, number>;
}

export interface PerfMetrics {
  url: string;
  /** Time to DOMContentLoaded (ms from navigation start). */
  domContentLoaded: number;
  /** Load event end (ms from navigation start). */
  loadComplete: number;
  /** First Contentful Paint (ms), when available. */
  firstContentfulPaint: number | null;
  /** Time to first byte (ms). */
  ttfb: number;
  /** Number of network requests captured. */
  resourceCount: number;
  /** Total transferred bytes across resources. */
  transferBytes: number;
}

export interface LoginResult {
  ok: boolean;
  url: string;
  usedSelectors: { username: string; password: string; submit: string | null };
  detail?: string;
}

export interface SnapshotResult {
  url: string;
  title: string;
  headings: string[];
  links: number;
  forms: number;
  a11y: A11yChecks;
  consoleErrors: string[];
  pageErrors: string[];
}

export class BrowserController {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private consoleErrors: string[] = [];
  private pageErrors: string[] = [];

  constructor(
    private baseUrl: string,
    private opts: {
      headed?: boolean;
      slowMo?: number;
      /** Load this Playwright storageState file into the context if it exists. */
      storageStatePath?: string;
    } = {},
  ) {}

  private async ensurePage(): Promise<Page> {
    if (this.page) return this.page;
    const headed = this.opts.headed ?? false;
    this.browser = await chromium.launch({
      headless: !headed,
      // When visible, slow actions down a little so they are watchable.
      slowMo: this.opts.slowMo ?? (headed ? 350 : 0),
    });
    const storageState =
      this.opts.storageStatePath && existsSync(this.opts.storageStatePath)
        ? this.opts.storageStatePath
        : undefined;
    this.context = await this.browser.newContext({
      viewport: { width: 1280, height: 800 },
      storageState,
    });
    this.page = await this.context.newPage();
    this.page.on("console", (msg) => {
      if (msg.type() === "error") this.consoleErrors.push(msg.text());
    });
    this.page.on("pageerror", (err) => this.pageErrors.push(err.message));
    return this.page;
  }

  /** Persist the current context's cookies/localStorage to a storageState file. */
  async saveStorageState(path: string): Promise<void> {
    if (!this.context) return;
    await this.context.storageState({ path });
  }

  private resolve(path: string): string {
    try {
      return new URL(path, this.baseUrl).toString();
    } catch {
      return this.baseUrl;
    }
  }

  async goto(path: string): Promise<{ status: number | null; url: string }> {
    const page = await this.ensurePage();
    const res = await page.goto(this.resolve(path), {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    return { status: res?.status() ?? null, url: page.url() };
  }

  async click(opts: { selector?: string; text?: string }): Promise<void> {
    const page = await this.ensurePage();
    if (opts.selector) {
      await page.click(opts.selector, { timeout: 10000 });
    } else if (opts.text) {
      await page.getByText(opts.text, { exact: false }).first().click({ timeout: 10000 });
    } else {
      throw new Error("click requires a selector or text");
    }
    await page.waitForLoadState("domcontentloaded").catch(() => {});
  }

  async fill(selector: string, value: string): Promise<void> {
    const page = await this.ensurePage();
    await page.fill(selector, value, { timeout: 10000 });
  }

  async press(key: string): Promise<void> {
    const page = await this.ensurePage();
    await page.keyboard.press(key);
    await page.waitForLoadState("domcontentloaded").catch(() => {});
  }

  async screenshot(): Promise<Buffer> {
    const page = await this.ensurePage();
    return page.screenshot({ fullPage: false });
  }

  /** True once a page exists (so the screencast never launches the browser early). */
  hasPage(): boolean {
    return this.page !== null;
  }

  /**
   * Viewport screenshot for the live screencast. Returns null (never throws) if
   * the page isn't ready or the capture fails — safe to call on a timer.
   */
  async liveSnapshot(): Promise<Buffer | null> {
    if (!this.page) return null;
    try {
      return await this.page.screenshot({ fullPage: false, timeout: 5000 });
    } catch {
      return null;
    }
  }

  /** Deterministic full-page screenshot (fixed viewport) for visual regression. */
  async fullScreenshot(): Promise<Buffer> {
    const page = await this.ensurePage();
    return page.screenshot({ fullPage: true });
  }

  async snapshot(): Promise<SnapshotResult> {
    const page = await this.ensurePage();
    const data = await page.evaluate(() => {
      const imagesMissingAlt = Array.from(document.images).filter(
        (img) => !img.getAttribute("alt"),
      ).length;
      const inputs = Array.from(
        document.querySelectorAll("input, select, textarea"),
      ) as HTMLElement[];
      const inputsMissingLabel = inputs.filter((el) => {
        const id = el.getAttribute("id");
        const hasLabel = id && document.querySelector(`label[for="${id}"]`);
        const aria =
          el.getAttribute("aria-label") || el.getAttribute("aria-labelledby");
        const type = (el.getAttribute("type") || "").toLowerCase();
        if (type === "hidden" || type === "submit" || type === "button") return false;
        return !hasLabel && !aria;
      }).length;
      const buttons = Array.from(
        document.querySelectorAll("button, [role=button]"),
      ) as HTMLElement[];
      const buttonsMissingName = buttons.filter((el) => {
        const txt = (el.textContent || "").trim();
        const aria = el.getAttribute("aria-label");
        return !txt && !aria;
      }).length;
      const headings = (
        Array.from(document.querySelectorAll("h1, h2, h3")) as HTMLElement[]
      )
        .map((h) => (h.textContent || "").trim())
        .filter(Boolean)
        .slice(0, 20);
      return {
        title: document.title,
        headings,
        links: document.querySelectorAll("a[href]").length,
        forms: document.querySelectorAll("form").length,
        imagesMissingAlt,
        inputsMissingLabel,
        buttonsMissingName,
        documentHasTitle: !!document.title,
        htmlHasLang: !!document.documentElement.getAttribute("lang"),
      };
    });

    return {
      url: page.url(),
      title: data.title,
      headings: data.headings,
      links: data.links,
      forms: data.forms,
      a11y: {
        imagesMissingAlt: data.imagesMissingAlt,
        inputsMissingLabel: data.inputsMissingLabel,
        buttonsMissingName: data.buttonsMissingName,
        documentHasTitle: data.documentHasTitle,
        htmlHasLang: data.htmlHasLang,
      },
      consoleErrors: [...this.consoleErrors],
      pageErrors: [...this.pageErrors],
    };
  }

  /**
   * Log into the target app. Navigates to the login page, fills the username
   * and password fields (auto-detecting them when selectors are not supplied),
   * submits, and waits for navigation. Subsequent browser actions reuse the
   * authenticated session/cookies.
   */
  async login(auth: AuthConfig): Promise<LoginResult> {
    const page = await this.ensurePage();
    await page.goto(this.resolve(auth.loginPath), {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    const usernameSel =
      auth.usernameSelector ??
      (await this.firstExisting(page, [
        "input[type=email]",
        "input[name*=email i]",
        "input[name*=user i]",
        "input[id*=email i]",
        "input[id*=user i]",
        "input[autocomplete=username]",
        "input[type=text]",
      ]));
    const passwordSel =
      auth.passwordSelector ??
      (await this.firstExisting(page, [
        "input[type=password]",
        "input[name*=pass i]",
        "input[id*=pass i]",
      ]));

    if (!usernameSel || !passwordSel) {
      return {
        ok: false,
        url: page.url(),
        usedSelectors: {
          username: usernameSel ?? "(not found)",
          password: passwordSel ?? "(not found)",
          submit: null,
        },
        detail: "Could not locate the username/password fields on the login page.",
      };
    }

    await page.fill(usernameSel, auth.username, { timeout: 10000 });
    await page.fill(passwordSel, auth.password, { timeout: 10000 });

    const submitSel =
      auth.submitSelector ??
      (await this.firstExisting(page, ["button[type=submit]", "input[type=submit]"]));

    try {
      if (submitSel) {
        await Promise.all([
          page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {}),
          page.click(submitSel, { timeout: 10000 }),
        ]);
      } else {
        await Promise.all([
          page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {}),
          page.locator(passwordSel).press("Enter"),
        ]);
      }
    } catch (e) {
      return {
        ok: false,
        url: page.url(),
        usedSelectors: { username: usernameSel, password: passwordSel, submit: submitSel ?? null },
        detail: e instanceof Error ? e.message : String(e),
      };
    }

    return {
      ok: true,
      url: page.url(),
      usedSelectors: { username: usernameSel, password: passwordSel, submit: submitSel ?? null },
    };
  }

  private async firstExisting(page: Page, selectors: string[]): Promise<string | undefined> {
    for (const sel of selectors) {
      if ((await page.locator(sel).count()) > 0) return sel;
    }
    return undefined;
  }

  /** Run an axe-core accessibility audit against the current page. */
  async axeAudit(): Promise<AxeResult> {
    const page = await this.ensurePage();
    await page.addScriptTag({ content: getAxeSource() });
    const raw = (await page.evaluate(async () => {
      // @ts-expect-error axe is injected onto window by addScriptTag above.
      return await window.axe.run(document, {
        resultTypes: ["violations"],
        runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] },
      });
    })) as {
      violations: {
        id: string;
        impact: string | null;
        help: string;
        helpUrl: string;
        nodes: { target: string[] }[];
      }[];
    };

    const byImpact: Record<string, number> = {};
    const violations: AxeViolation[] = raw.violations.map((v) => {
      const impact = v.impact ?? "unknown";
      byImpact[impact] = (byImpact[impact] ?? 0) + 1;
      return {
        id: v.id,
        impact: v.impact,
        help: v.help,
        helpUrl: v.helpUrl,
        nodes: v.nodes.length,
        sampleTarget: v.nodes[0]?.target?.[0] ?? null,
      };
    });

    return { url: page.url(), violations, violationCount: violations.length, byImpact };
  }

  /** Collect lightweight performance metrics for the current page. */
  async perfMetrics(): Promise<PerfMetrics> {
    const page = await this.ensurePage();
    const data = await page.evaluate(() => {
      const nav = performance.getEntriesByType("navigation")[0] as
        | PerformanceNavigationTiming
        | undefined;
      const fcpEntry = performance
        .getEntriesByType("paint")
        .find((p) => p.name === "first-contentful-paint");
      const resources = performance.getEntriesByType(
        "resource",
      ) as PerformanceResourceTiming[];
      const transferBytes = resources.reduce((sum, r) => sum + (r.transferSize || 0), 0);
      return {
        domContentLoaded: nav ? Math.round(nav.domContentLoadedEventEnd) : 0,
        loadComplete: nav ? Math.round(nav.loadEventEnd) : 0,
        ttfb: nav ? Math.round(nav.responseStart) : 0,
        firstContentfulPaint: fcpEntry ? Math.round(fcpEntry.startTime) : null,
        resourceCount: resources.length,
        transferBytes,
      };
    });
    return { url: page.url(), ...data };
  }

  async close(): Promise<void> {
    try {
      await this.browser?.close();
    } catch {
      /* ignore */
    }
    this.browser = null;
    this.context = null;
    this.page = null;
  }
}
