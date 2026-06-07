import "server-only";
import type { RunReport, Severity, Finding } from "@/lib/types";

const SEVERITY_ORDER: Severity[] = ["critical", "major", "minor", "info"];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function countBySeverity(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { critical: 0, major: 0, minor: 0, info: 0 };
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}

function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity),
  );
}

function projectName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

function fmtDate(ms: number | null): string {
  return ms ? new Date(ms).toISOString() : "—";
}

/** Build a portable Markdown report for a run. */
export function buildMarkdownReport(report: RunReport): string {
  const { run, findings } = report;
  const counts = countBySeverity(findings);
  const lines: string[] = [];

  lines.push(`# Wizard Test Report — ${projectName(run.projectPath)}`);
  lines.push("");
  lines.push(`- **Project:** ${run.projectPath}`);
  lines.push(`- **Status:** ${run.status}`);
  lines.push(`- **Mode:** ${run.mode}${run.url ? ` (${run.url})` : ""}`);
  lines.push(
    `- **Scope:** ${(["ui", "ux", "api"] as const).filter((k) => run.scope[k]).join(", ").toUpperCase() || "—"}`,
  );
  lines.push(`- **Started:** ${fmtDate(run.startedAt)}`);
  lines.push(`- **Finished:** ${fmtDate(run.finishedAt)}`);
  lines.push(`- **Token usage:** ${run.tokenUsage}`);
  lines.push("");
  lines.push(
    `**Findings:** ${findings.length} total — ` +
      `${counts.critical} critical, ${counts.major} major, ${counts.minor} minor, ${counts.info} info.`,
  );
  if (run.summary) {
    lines.push("");
    lines.push(`> ${run.summary}`);
  }
  lines.push("");
  lines.push("## Findings");
  lines.push("");

  if (findings.length === 0) {
    lines.push("_No findings recorded._");
  } else {
    for (const f of sortFindings(findings)) {
      lines.push(`### [${f.severity.toUpperCase()}] ${f.title}`);
      lines.push("");
      lines.push(`- **Category:** ${f.category}`);
      lines.push("");
      lines.push(f.detail);
      if (f.suggestion) {
        lines.push("");
        lines.push(`**Suggestion:** ${f.suggestion}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

/**
 * Build a self-contained HTML report. When `images` maps an artifact path to a
 * data-URI, screenshots are embedded so the file is portable (offline-viewable
 * and printable to PDF).
 */
export function buildHtmlReport(
  report: RunReport,
  images: Record<string, string> = {},
): string {
  const { run, findings } = report;
  const counts = countBySeverity(findings);
  const name = escapeHtml(projectName(run.projectPath));

  const sevColor: Record<Severity, string> = {
    critical: "#dc2626",
    major: "#ea580c",
    minor: "#ca8a04",
    info: "#0284c7",
  };

  const findingCards = sortFindings(findings)
    .map((f) => {
      const img =
        f.screenshotPath && images[f.screenshotPath]
          ? `<img src="${images[f.screenshotPath]}" alt="screenshot for ${escapeHtml(f.title)}" />`
          : "";
      const suggestion = f.suggestion
        ? `<p class="suggestion"><strong>Suggestion:</strong> ${escapeHtml(f.suggestion)}</p>`
        : "";
      return `
      <article class="finding">
        <header>
          <span class="badge" style="background:${sevColor[f.severity]}">${f.severity}</span>
          <span class="cat">${escapeHtml(f.category)}</span>
          <h3>${escapeHtml(f.title)}</h3>
        </header>
        <p class="detail">${escapeHtml(f.detail)}</p>
        ${suggestion}
        ${img}
      </article>`;
    })
    .join("\n");

  const scope =
    (["ui", "ux", "api"] as const).filter((k) => run.scope[k]).join(", ").toUpperCase() || "—";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Wizard Test Report — ${name}</title>
<style>
  :root { color-scheme: light; }
  * { box-sizing: border-box; }
  body { font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif; margin: 0; background: #f4f4f5; color: #18181b; }
  .wrap { max-width: 880px; margin: 0 auto; padding: 2rem 1.25rem 4rem; }
  h1 { font-size: 1.6rem; margin: 0 0 .25rem; }
  .meta { color: #71717a; font-size: .85rem; margin-bottom: 1.5rem; }
  .grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: .75rem; margin: 1rem 0 1.5rem; }
  .stat { background: #fff; border: 1px solid #e4e4e7; border-radius: .5rem; padding: .75rem; }
  .stat .k { font-size: .7rem; color: #a1a1aa; text-transform: uppercase; }
  .stat .v { font-size: 1.25rem; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; background: #fff; border: 1px solid #e4e4e7; border-radius: .5rem; overflow: hidden; margin-bottom: 1.5rem; }
  td, th { padding: .5rem .75rem; text-align: left; font-size: .85rem; border-bottom: 1px solid #f4f4f5; }
  .finding { background: #fff; border: 1px solid #e4e4e7; border-radius: .5rem; padding: 1rem; margin-bottom: 1rem; }
  .finding header { display: flex; align-items: center; gap: .5rem; flex-wrap: wrap; }
  .finding h3 { margin: 0; font-size: 1rem; flex: 1 1 100%; }
  .badge { color: #fff; font-size: .7rem; font-weight: 700; padding: .15rem .5rem; border-radius: .3rem; text-transform: uppercase; }
  .cat { font-size: .7rem; font-weight: 600; color: #52525b; background: #f4f4f5; padding: .15rem .5rem; border-radius: .3rem; }
  .detail { white-space: pre-wrap; color: #3f3f46; font-size: .9rem; }
  .suggestion { color: #52525b; font-size: .85rem; }
  .finding img { max-width: 100%; border: 1px solid #e4e4e7; border-radius: .4rem; margin-top: .5rem; }
  footer { color: #a1a1aa; font-size: .75rem; text-align: center; margin-top: 2rem; }
</style>
</head>
<body>
  <div class="wrap">
    <h1>Wizard Test Report — ${name}</h1>
    <div class="meta">${escapeHtml(run.projectPath)}</div>

    <div class="grid">
      <div class="stat"><div class="k">Status</div><div class="v">${escapeHtml(run.status)}</div></div>
      <div class="stat"><div class="k">Scope</div><div class="v" style="font-size:.95rem">${escapeHtml(scope)}</div></div>
      <div class="stat"><div class="k">Findings</div><div class="v">${findings.length}</div></div>
      <div class="stat"><div class="k">Tokens</div><div class="v">${run.tokenUsage}</div></div>
    </div>

    <table>
      <tr><th>Critical</th><th>Major</th><th>Minor</th><th>Info</th></tr>
      <tr><td>${counts.critical}</td><td>${counts.major}</td><td>${counts.minor}</td><td>${counts.info}</td></tr>
    </table>

    ${run.summary ? `<p>${escapeHtml(run.summary)}</p>` : ""}

    <h2>Findings</h2>
    ${findings.length === 0 ? "<p>No findings recorded.</p>" : findingCards}

    <footer>Generated by Copilot Testing Wizard · ${new Date().toISOString()}</footer>
  </div>
</body>
</html>`;
}

/** Suggested download filename (without directory) for a report. */
export function reportFilename(report: RunReport, ext: "html" | "md" | "json" | "xml"): string {
  const name = projectName(report.run.projectPath).replace(/[^a-z0-9-_]/gi, "_");
  return `wizard-report-${name}-${report.run.id.slice(0, 8)}.${ext}`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Build a JUnit XML report so runs can be consumed by CI (GitHub Actions,
 * Jenkins, etc). Each finding becomes a testcase: critical/major → failure,
 * minor → skipped (warning), info → passed.
 */
export function buildJUnitReport(report: RunReport): string {
  const { run, findings } = report;
  const suiteName = projectName(run.projectPath);
  const failures = findings.filter(
    (f) => f.severity === "critical" || f.severity === "major",
  ).length;
  const skipped = findings.filter((f) => f.severity === "minor").length;
  const durationSec =
    run.finishedAt && run.startedAt ? Math.max(0, (run.finishedAt - run.startedAt) / 1000) : 0;

  const cases = sortFindings(findings)
    .map((f) => {
      const name = escapeXml(`[${f.category}] ${f.title}`);
      const classname = escapeXml(`wizard.${f.category}`);
      const open = `    <testcase name="${name}" classname="${classname}">`;
      if (f.severity === "critical" || f.severity === "major") {
        const msg = escapeXml(f.title);
        const body = escapeXml(f.detail + (f.suggestion ? `\n\nSuggestion: ${f.suggestion}` : ""));
        return `${open}\n      <failure message="${msg}" type="${f.severity}">${body}</failure>\n    </testcase>`;
      }
      if (f.severity === "minor") {
        return `${open}\n      <skipped message="${escapeXml(f.detail)}" />\n    </testcase>`;
      }
      return `    <testcase name="${name}" classname="${classname}" />`;
    })
    .join("\n");

  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<testsuites name="Copilot Testing Wizard" tests="${findings.length}" failures="${failures}" skipped="${skipped}" time="${durationSec.toFixed(3)}">`,
    `  <testsuite name="${escapeXml(suiteName)}" tests="${findings.length}" failures="${failures}" skipped="${skipped}" time="${durationSec.toFixed(3)}">`,
    cases,
    `  </testsuite>`,
    `</testsuites>`,
  ]
    .filter(Boolean)
    .join("\n");
}
