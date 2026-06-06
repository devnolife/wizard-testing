"use client";

import { useParams } from "next/navigation";
import { useEffect, useRef, useState, useCallback } from "react";
import type { RunEvent, RunReport } from "@/lib/types";
import { statusColor, severityColor, categoryColor, formatDuration } from "@/lib/format";

function artifactUrl(path: string): string {
  return `/api/artifact?path=${encodeURIComponent(path)}`;
}

export default function RunPage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [report, setReport] = useState<RunReport | null>(null);
  const [live, setLive] = useState(true);
  const timelineRef = useRef<HTMLDivElement>(null);

  const loadReport = useCallback(async () => {
    const res = await fetch(`/api/runs/${id}`);
    if (res.ok) setReport(await res.json());
  }, [id]);

  useEffect(() => {
    loadReport();
    const es = new EventSource(`/api/runs/${id}/stream`);
    es.onmessage = (msg) => {
      const event = JSON.parse(msg.data) as RunEvent;
      setEvents((prev) => [...prev, event]);
      if (event.kind === "finding" || event.kind === "done") loadReport();
      if (event.kind === "done") {
        setLive(false);
        es.close();
      }
    };
    es.onerror = () => {
      setLive(false);
      es.close();
    };
    return () => es.close();
  }, [id, loadReport]);

  useEffect(() => {
    timelineRef.current?.scrollTo({ top: timelineRef.current.scrollHeight });
  }, [events]);

  const run = report?.run;
  const findings = report?.findings ?? [];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">
            {run ? run.projectPath.split(/[\\/]/).pop() : "Run"}
          </h1>
          <p className="text-xs text-zinc-400">{run?.projectPath}</p>
        </div>
        <div className="flex items-center gap-3 text-sm">
          {live && <span className="flex items-center gap-1 text-blue-600"><span className="h-2 w-2 animate-pulse rounded-full bg-blue-600" />live</span>}
          {run && (
            <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusColor(run.status)}`}>
              {run.status}
            </span>
          )}
        </div>
      </div>

      {run && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="Mode" value={run.mode} />
          <Stat label="Scope" value={["ui", "ux", "api"].filter((k) => run.scope[k as "ui"]).join(", ").toUpperCase() || "—"} />
          <Stat label="Duration" value={formatDuration(run.startedAt, run.finishedAt)} />
          <Stat label="Findings" value={String(findings.length)} />
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-700">Live timeline</h2>
          <div
            ref={timelineRef}
            className="h-[28rem] overflow-y-auto rounded-lg border border-zinc-200 bg-white p-3 text-sm"
          >
            {events.length === 0 && <p className="text-zinc-400">Waiting for events…</p>}
            <ul className="space-y-2">
              {events.map((e) => (
                <li key={e.id} className="flex gap-2">
                  <span className="shrink-0 text-xs text-zinc-400">
                    {new Date(e.ts).toLocaleTimeString()}
                  </span>
                  <span className="shrink-0">{kindIcon(e.kind)}</span>
                  <div className="min-w-0">
                    <span className="break-words text-zinc-700">{e.message}</span>
                    {e.kind === "screenshot" && typeof e.payload?.path === "string" && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={artifactUrl(e.payload.path as string)}
                        alt="screenshot"
                        className="mt-1 max-h-40 rounded border border-zinc-200"
                      />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-sm font-semibold text-zinc-700">Findings</h2>
          <div className="space-y-3">
            {findings.length === 0 && (
              <p className="rounded-lg border border-dashed border-zinc-300 bg-white p-6 text-center text-sm text-zinc-400">
                No findings yet.
              </p>
            )}
            {findings.map((f) => (
              <div key={f.id} className="rounded-lg border border-zinc-200 bg-white p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${categoryColor(f.category)}`}>
                    {f.category}
                  </span>
                  <span className={`rounded border px-1.5 py-0.5 text-xs font-medium ${severityColor(f.severity)}`}>
                    {f.severity}
                  </span>
                  <span className="font-medium">{f.title}</span>
                </div>
                <p className="mt-2 whitespace-pre-wrap text-sm text-zinc-600">{f.detail}</p>
                {f.suggestion && (
                  <p className="mt-2 text-sm text-zinc-500">
                    <span className="font-medium text-zinc-700">Suggestion: </span>
                    {f.suggestion}
                  </p>
                )}
                {f.screenshotPath && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={artifactUrl(f.screenshotPath)}
                    alt="finding screenshot"
                    className="mt-2 max-h-56 rounded border border-zinc-200"
                  />
                )}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-3">
      <div className="text-xs text-zinc-400">{label}</div>
      <div className="mt-0.5 truncate text-sm font-medium">{value}</div>
    </div>
  );
}

function kindIcon(kind: RunEvent["kind"]): string {
  switch (kind) {
    case "step":
      return "▶️";
    case "tool":
      return "🔧";
    case "finding":
      return "🐞";
    case "screenshot":
      return "📸";
    case "error":
      return "❌";
    case "done":
      return "🏁";
    case "log":
      return "💬";
    default:
      return "•";
  }
}
