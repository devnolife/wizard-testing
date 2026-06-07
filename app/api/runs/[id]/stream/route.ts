import { getOrchestrator, getStoredEvents } from "@/server/orchestrator";
import type { RunEvent } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sse(event: RunEvent): string {
  return `id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const orchestrator = getOrchestrator();
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let lastId = 0;
      let closed = false;
      let unsubscribe = () => {};
      const safeClose = () => {
        if (closed) return;
        closed = true;
        unsubscribe();
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // Replay stored events first.
      for (const e of getStoredEvents(id, 0)) {
        controller.enqueue(encoder.encode(sse(e)));
        lastId = e.id;
        if (e.kind === "done") {
          // Run already finished — flush and close after replay.
          safeClose();
          return;
        }
      }

      // Subscribe to live events; skip any already replayed.
      unsubscribe = orchestrator.subscribe(id, (e) => {
        // Transient screencast frames carry no persistent id — never dedup them.
        if (e.kind !== "live_frame") {
          if (e.id <= lastId) return;
          lastId = e.id;
        }
        try {
          controller.enqueue(encoder.encode(sse(e)));
        } catch {
          safeClose();
          return;
        }
        if (e.kind === "done") safeClose();
      });

      // If the run is not active, there is nothing more to stream.
      if (!orchestrator.isActive(id)) {
        safeClose();
        return;
      }

      request.signal.addEventListener("abort", safeClose);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
