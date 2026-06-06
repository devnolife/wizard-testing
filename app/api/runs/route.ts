import { NextResponse } from "next/server";
import { getOrchestrator } from "@/server/orchestrator";
import { listRuns } from "@/server/store/db";
import { validateRunConfig } from "@/server/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ runs: listRuns() });
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const result = validateRunConfig(body);
  if (!result.ok || !result.config) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  const run = getOrchestrator().startRun(result.config);
  return NextResponse.json({ run }, { status: 201 });
}
