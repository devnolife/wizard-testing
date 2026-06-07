import { describe, it, expect } from "vitest";
import {
  buildHtmlReport,
  buildMarkdownReport,
  buildJUnitReport,
  reportFilename,
} from "@/server/report/export";
import type { RunReport, Finding } from "@/lib/types";

function finding(over: Partial<Finding> = {}): Finding {
  return {
    id: "f1",
    runId: "run-123",
    category: "UI",
    title: "Broken link",
    severity: "major",
    detail: "The footer link 404s.",
    screenshotPath: null,
    suggestion: "Fix the href.",
    createdAt: 1,
    ...over,
  };
}

const report: RunReport = {
  run: {
    id: "run-1234abcd",
    projectPath: "D:\\projects\\my-app",
    mode: "auto-start",
    scope: { ui: true, ux: false, api: true },
    saveMode: "ephemeral",
    status: "failed",
    startedAt: 1700000000000,
    finishedAt: 1700000050000,
    tokenUsage: 4200,
    summary: "2 findings.",
  },
  findings: [
    finding({ id: "a", severity: "minor", title: "Minor one" }),
    finding({ id: "b", severity: "critical", title: "Critical <script>" }),
  ],
  artifacts: [],
};

describe("buildMarkdownReport", () => {
  it("includes header, project, status and findings", () => {
    const md = buildMarkdownReport(report);
    expect(md).toContain("# Wizard Test Report — my-app");
    expect(md).toContain("**Status:** failed");
    expect(md).toContain("[CRITICAL] Critical <script>");
    expect(md).toContain("Fix the href.");
  });

  it("sorts findings by severity (critical first)", () => {
    const md = buildMarkdownReport(report);
    expect(md.indexOf("[CRITICAL]")).toBeLessThan(md.indexOf("[MINOR]"));
  });

  it("handles a run with no findings", () => {
    const md = buildMarkdownReport({ ...report, findings: [] });
    expect(md).toContain("_No findings recorded._");
  });
});

describe("buildHtmlReport", () => {
  it("produces a self-contained HTML document", () => {
    const html = buildHtmlReport(report);
    expect(html).toMatch(/^<!doctype html>/i);
    expect(html).toContain("Wizard Test Report — my-app");
  });

  it("escapes HTML in finding titles to prevent injection", () => {
    const html = buildHtmlReport(report);
    expect(html).toContain("Critical &lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("embeds screenshots as data URIs when provided", () => {
    const withShot: RunReport = {
      ...report,
      findings: [finding({ screenshotPath: "/abs/shot.png" })],
    };
    const html = buildHtmlReport(withShot, { "/abs/shot.png": "data:image/png;base64,AAAA" });
    expect(html).toContain("data:image/png;base64,AAAA");
  });
});

describe("reportFilename", () => {
  it("builds a safe filename with the run id prefix", () => {
    expect(reportFilename(report, "html")).toBe("wizard-report-my-app-run-1234.html");
  });
});

describe("buildJUnitReport", () => {
  it("produces valid JUnit XML with correct failure counts", () => {
    const xml = buildJUnitReport(report);
    expect(xml).toMatch(/^<\?xml/);
    expect(xml).toContain('<testsuites name="Copilot Testing Wizard"');
    // 1 critical counts as a failure, 1 minor counts as skipped.
    expect(xml).toContain('failures="1"');
    expect(xml).toContain('skipped="1"');
  });

  it("maps critical/major findings to <failure> and escapes XML", () => {
    const xml = buildJUnitReport(report);
    expect(xml).toContain('<failure message="Critical &lt;script&gt;"');
    expect(xml).not.toContain("<script>");
  });

  it("maps minor findings to <skipped>", () => {
    const xml = buildJUnitReport(report);
    expect(xml).toContain("<skipped");
  });
});
