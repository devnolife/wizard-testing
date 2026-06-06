"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { RunConfig } from "@/lib/types";

export default function NewRunPage() {
  const router = useRouter();
  const [projectPath, setProjectPath] = useState("");
  const [mode, setMode] = useState<"auto-start" | "url">("auto-start");
  const [url, setUrl] = useState("http://localhost:3000");
  const [scope, setScope] = useState({ ui: true, ux: true, api: true });
  const [saveMode, setSaveMode] = useState<"ephemeral" | "project">("ephemeral");
  const [saveDir, setSaveDir] = useState("tests/wizard");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const config: RunConfig = {
      projectPath: projectPath.trim(),
      mode,
      url: mode === "url" ? url.trim() : undefined,
      scope,
      saveMode,
      saveDir: saveMode === "project" ? saveDir.trim() : undefined,
    };
    try {
      const res = await fetch("/api/runs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Failed to start run");
        setSubmitting(false);
        return;
      }
      router.push(`/runs/${data.run.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Network error");
      setSubmitting(false);
    }
  }

  const label = "block text-sm font-medium text-zinc-700";
  const input =
    "mt-1 w-full rounded-md border border-zinc-300 px-3 py-2 text-sm shadow-sm focus:border-zinc-500 focus:outline-none";

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">New Test Run</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Point the wizard at a full-stack Next.js project. Copilot will plan, run, and analyze the tests.
      </p>

      <form onSubmit={submit} className="mt-6 space-y-6 rounded-lg border border-zinc-200 bg-white p-6">
        <div>
          <label className={label}>Project path</label>
          <input
            className={input}
            placeholder="D:\\path\\to\\your-next-app"
            value={projectPath}
            onChange={(e) => setProjectPath(e.target.value)}
            required
          />
        </div>

        <fieldset>
          <legend className={label}>How to run the app</legend>
          <div className="mt-2 space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={mode === "auto-start"} onChange={() => setMode("auto-start")} />
              Auto-start (wizard runs <code>npm run dev</code> and detects crashes)
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={mode === "url"} onChange={() => setMode("url")} />
              Use a running URL
            </label>
            {mode === "url" && (
              <input className={input} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://localhost:3000" />
            )}
          </div>
        </fieldset>

        <fieldset>
          <legend className={label}>Test scope</legend>
          <div className="mt-2 flex gap-4 text-sm">
            {(["ui", "ux", "api"] as const).map((k) => (
              <label key={k} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={scope[k]}
                  onChange={(e) => setScope({ ...scope, [k]: e.target.checked })}
                />
                {k.toUpperCase()}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className={label}>Generated tests</legend>
          <div className="mt-2 space-y-2 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" checked={saveMode === "ephemeral"} onChange={() => setSaveMode("ephemeral")} />
              Ephemeral (keep as run artifacts only)
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" checked={saveMode === "project"} onChange={() => setSaveMode("project")} />
              Save into the project
            </label>
            {saveMode === "project" && (
              <input className={input} value={saveDir} onChange={(e) => setSaveDir(e.target.value)} placeholder="tests/wizard" />
            )}
          </div>
        </fieldset>

        {error && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>}

        <button
          type="submit"
          disabled={submitting}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:opacity-50"
        >
          {submitting ? "Starting…" : "Start run"}
        </button>
      </form>
    </div>
  );
}
