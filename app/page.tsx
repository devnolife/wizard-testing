import Link from "next/link";
import { listRuns } from "@/server/store/db";
import { statusColor, formatTime, formatDuration } from "@/lib/format";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default function Home() {
  const runs = listRuns();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Test Runs</h1>
          <p className="text-sm text-zinc-500">
            AI-driven UI, UX &amp; API testing for your Next.js projects.
          </p>
        </div>
      </div>

      {runs.length === 0 ? (
        <div className="rounded-lg border border-dashed border-zinc-300 bg-white p-10 text-center">
          <p className="text-zinc-600">No runs yet.</p>
          <Link
            href="/new"
            className="mt-3 inline-block rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700"
          >
            Start your first run
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left text-zinc-500">
              <tr>
                <th className="px-4 py-2 font-medium">Project</th>
                <th className="px-4 py-2 font-medium">Status</th>
                <th className="px-4 py-2 font-medium">Started</th>
                <th className="px-4 py-2 font-medium">Duration</th>
                <th className="px-4 py-2 font-medium">Summary</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((run) => (
                <tr key={run.id} className="border-t border-zinc-100 hover:bg-zinc-50">
                  <td className="px-4 py-3">
                    <Link href={`/runs/${run.id}`} className="font-medium text-blue-700 hover:underline">
                      {run.projectPath.split(/[\\/]/).pop() || run.projectPath}
                    </Link>
                    <div className="text-xs text-zinc-400">{run.projectPath}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full border px-2 py-0.5 text-xs font-medium ${statusColor(run.status)}`}>
                      {run.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-zinc-600">{formatTime(run.startedAt)}</td>
                  <td className="px-4 py-3 text-zinc-600">{formatDuration(run.startedAt, run.finishedAt)}</td>
                  <td className="px-4 py-3 text-zinc-600">{run.summary ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
