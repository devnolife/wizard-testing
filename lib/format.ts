import type { RunStatus, Severity, FindingCategory, Scope } from "./types";
import { SCOPE_META } from "./types";

/** Human-readable list of enabled scope labels (e.g. "UI, API, Performance"). */
export function formatScope(scope: Scope): string {
  const on = SCOPE_META.filter((m) => scope[m.key]).map((m) => m.label);
  return on.length ? on.join(", ") : "—";
}

export function statusColor(status: RunStatus): string {
  switch (status) {
    case "passed":
      return "bg-green-100 text-green-800 border-green-300";
    case "failed":
      return "bg-red-100 text-red-800 border-red-300";
    case "running":
      return "bg-blue-100 text-blue-800 border-blue-300";
    case "error":
      return "bg-amber-100 text-amber-800 border-amber-300";
    case "cancelled":
      return "bg-zinc-100 text-zinc-700 border-zinc-300";
    default:
      return "bg-zinc-100 text-zinc-700 border-zinc-300";
  }
}

export function severityColor(sev: Severity): string {
  switch (sev) {
    case "critical":
      return "bg-red-100 text-red-800 border-red-300";
    case "major":
      return "bg-orange-100 text-orange-800 border-orange-300";
    case "minor":
      return "bg-yellow-100 text-yellow-800 border-yellow-300";
    case "info":
      return "bg-sky-100 text-sky-800 border-sky-300";
  }
}

export function categoryColor(cat: FindingCategory): string {
  switch (cat) {
    case "UI":
      return "bg-indigo-100 text-indigo-800";
    case "UX":
      return "bg-fuchsia-100 text-fuchsia-800";
    case "API":
      return "bg-teal-100 text-teal-800";
    case "PROCESS":
      return "bg-rose-100 text-rose-800";
    case "PERF":
      return "bg-amber-100 text-amber-800";
    case "A11Y":
      return "bg-cyan-100 text-cyan-800";
    case "SEO":
      return "bg-lime-100 text-lime-800";
    case "SECURITY":
      return "bg-red-100 text-red-800";
    case "VISUAL":
      return "bg-violet-100 text-violet-800";
  }
}

export function formatTime(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString();
}

export function formatDuration(start: number, end: number | null): string {
  if (!end) return "in progress";
  const s = Math.round((end - start) / 1000);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
}
