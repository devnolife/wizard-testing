import { readFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { getReport, ARTIFACTS_DIR } from "@/server/store/db";
import {
  buildHtmlReport,
  buildMarkdownReport,
  buildJUnitReport,
  reportFilename,
} from "@/server/report/export";
import type { RunReport } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Read screenshot artifacts referenced by findings and inline them as data URIs. */
async function embedScreenshots(report: RunReport): Promise<Record<string, string>> {
  const base = resolve(ARTIFACTS_DIR);
  const out: Record<string, string> = {};
  for (const f of report.findings) {
    const p = f.screenshotPath;
    if (!p || out[p]) continue;
    const target = resolve(p);
    if (target !== base && !target.startsWith(base + sep)) continue;
    try {
      const data = await readFile(target);
      out[p] = `data:image/png;base64,${data.toString("base64")}`;
    } catch {
      /* skip missing screenshots */
    }
  }
  return out;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const report = getReport(id);
  if (!report) {
    return new Response("Run not found", { status: 404 });
  }

  const format = (new URL(request.url).searchParams.get("format") ?? "html").toLowerCase();

  let body: string;
  let contentType: string;
  let ext: "html" | "md" | "json" | "xml";

  if (format === "md" || format === "markdown") {
    body = buildMarkdownReport(report);
    contentType = "text/markdown; charset=utf-8";
    ext = "md";
  } else if (format === "json") {
    body = JSON.stringify(report, null, 2);
    contentType = "application/json; charset=utf-8";
    ext = "json";
  } else if (format === "junit" || format === "xml") {
    body = buildJUnitReport(report);
    contentType = "application/xml; charset=utf-8";
    ext = "xml";
  } else {
    const images = await embedScreenshots(report);
    body = buildHtmlReport(report, images);
    contentType = "text/html; charset=utf-8";
    ext = "html";
  }

  return new Response(body, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${reportFilename(report, ext)}"`,
      "Cache-Control": "no-cache",
    },
  });
}
