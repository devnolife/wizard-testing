import { readFile } from "node:fs/promises";
import { resolve, sep, extname } from "node:path";
import { ARTIFACTS_DIR } from "@/server/store/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".log": "text/plain; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const p = url.searchParams.get("path");
  if (!p) return new Response("Missing path", { status: 400 });

  const base = resolve(ARTIFACTS_DIR);
  const target = resolve(p);
  if (target !== base && !target.startsWith(base + sep)) {
    return new Response("Forbidden", { status: 403 });
  }

  try {
    const data = await readFile(target);
    const type = MIME[extname(target).toLowerCase()] ?? "application/octet-stream";
    return new Response(new Uint8Array(data), {
      headers: { "Content-Type": type, "Cache-Control": "no-cache" },
    });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}
