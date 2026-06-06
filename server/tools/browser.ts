import "server-only";
import { chromium, type Browser, type Page } from "playwright";

export interface A11yChecks {
  imagesMissingAlt: number;
  inputsMissingLabel: number;
  buttonsMissingName: number;
  documentHasTitle: boolean;
  htmlHasLang: boolean;
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
  private page: Page | null = null;
  private consoleErrors: string[] = [];
  private pageErrors: string[] = [];

  constructor(private baseUrl: string) {}

  private async ensurePage(): Promise<Page> {
    if (this.page) return this.page;
    this.browser = await chromium.launch({ headless: true });
    const context = await this.browser.newContext();
    this.page = await context.newPage();
    this.page.on("console", (msg) => {
      if (msg.type() === "error") this.consoleErrors.push(msg.text());
    });
    this.page.on("pageerror", (err) => this.pageErrors.push(err.message));
    return this.page;
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

  async close(): Promise<void> {
    try {
      await this.browser?.close();
    } catch {
      /* ignore */
    }
    this.browser = null;
    this.page = null;
  }
}
