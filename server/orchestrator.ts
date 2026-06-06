import "server-only";
import { EventEmitter } from "node:events";
import {
  createRun,
  updateRun,
  getRun,
  addEvent,
  addFinding,
  addArtifact,
  listEvents,
} from "./store/db";
import { writeScreenshot, writeLog } from "./store/artifacts";
import type {
  Run,
  RunConfig,
  RunEvent,
  RunEventKind,
  RunStatus,
  FindingCategory,
  Severity,
} from "@/lib/types";

/**
 * Context handed to a pipeline. It wraps persistence + live event emission so the
 * pipeline never touches the DB or the event bus directly.
 */
export interface RunContext {
  run: Run;
  signal: AbortSignal;
  emit(kind: RunEventKind, message: string, payload?: Record<string, unknown>): void;
  step(message: string, payload?: Record<string, unknown>): void;
  tool(name: string, message: string, payload?: Record<string, unknown>): void;
  finding(f: {
    category: FindingCategory;
    title: string;
    severity: Severity;
    detail: string;
    screenshot?: Buffer | null;
    screenshotPath?: string | null;
    suggestion?: string | null;
  }): void;
  screenshot(data: Buffer, label?: string): string;
  log(content: string, label?: string): string;
  addTokens(n: number): void;
}

/** A pipeline runs the full test flow for one run. Injected to avoid circular imports. */
export type Pipeline = (ctx: RunContext) => Promise<{
  status: Extract<RunStatus, "passed" | "failed" | "error">;
  summary: string;
}>;

interface ActiveRun {
  bus: EventEmitter;
  controller: AbortController;
  tokenUsage: number;
}

class Orchestrator {
  private active = new Map<string, ActiveRun>();
  private pipeline: Pipeline | null = null;

  /** Register the pipeline implementation (called once at startup). */
  setPipeline(p: Pipeline) {
    this.pipeline = p;
  }

  private async loadPipeline(): Promise<Pipeline> {
    if (this.pipeline) return this.pipeline;
    // Lazy import so the Copilot SDK / Playwright only load when a run starts.
    const mod = await import("./copilot/runner");
    this.pipeline = mod.runPipeline;
    return this.pipeline;
  }

  /** Subscribe to live events for a run. Returns an unsubscribe function. */
  subscribe(runId: string, listener: (e: RunEvent) => void): () => void {
    const active = this.active.get(runId);
    if (!active) return () => {};
    active.bus.on("event", listener);
    return () => active.bus.off("event", listener);
  }

  /** Whether a run is currently executing (has a live bus). */
  isActive(runId: string): boolean {
    return this.active.has(runId);
  }

  cancel(runId: string): boolean {
    const active = this.active.get(runId);
    if (!active) return false;
    active.controller.abort();
    return true;
  }

  /** Create a run and kick off its pipeline in the background. Returns immediately. */
  startRun(config: RunConfig): Run {
    const run = createRun(config);
    const controller = new AbortController();
    const active: ActiveRun = {
      bus: new EventEmitter(),
      controller,
      tokenUsage: 0,
    };
    active.bus.setMaxListeners(100);
    this.active.set(run.id, active);

    updateRun(run.id, { status: "running" });
    run.status = "running";

    // Fire and forget: not tied to the HTTP request lifecycle.
    void this.execute(run, active);
    return run;
  }

  private emit(
    runId: string,
    active: ActiveRun,
    kind: RunEventKind,
    message: string,
    payload?: Record<string, unknown>,
  ) {
    const event = addEvent(runId, kind, message, payload ?? null);
    active.bus.emit("event", event);
  }

  private buildContext(run: Run, active: ActiveRun): RunContext {
    const runId = run.id;
    return {
      run,
      signal: active.controller.signal,
      emit: (kind, message, payload) => this.emit(runId, active, kind, message, payload),
      step: (message, payload) => this.emit(runId, active, "step", message, payload),
      tool: (name, message, payload) =>
        this.emit(runId, active, "tool", message, { tool: name, ...payload }),
      finding: (f) => {
        let screenshotPath = f.screenshotPath ?? null;
        if (f.screenshot) {
          screenshotPath = writeScreenshot(runId, f.screenshot, "finding");
          addArtifact(runId, "screenshot", screenshotPath);
        }
        const finding = addFinding(runId, {
          category: f.category,
          title: f.title,
          severity: f.severity,
          detail: f.detail,
          screenshotPath,
          suggestion: f.suggestion ?? null,
        });
        this.emit(runId, active, "finding", f.title, {
          findingId: finding.id,
          category: f.category,
          severity: f.severity,
        });
      },
      screenshot: (data, label) => {
        const path = writeScreenshot(runId, data, label);
        addArtifact(runId, "screenshot", path);
        this.emit(runId, active, "screenshot", label ?? "screenshot", { path });
        return path;
      },
      log: (content, label) => {
        const path = writeLog(runId, content, label);
        addArtifact(runId, "log", path);
        return path;
      },
      addTokens: (n) => {
        active.tokenUsage += n;
        updateRun(runId, { tokenUsage: active.tokenUsage });
      },
    };
  }

  private async execute(run: Run, active: ActiveRun) {
    const ctx = this.buildContext(run, active);
    try {
      this.emit(run.id, active, "status", "Run started", { status: "running" });
      const pipeline = await this.loadPipeline();
      const result = await pipeline(ctx);
      updateRun(run.id, {
        status: result.status,
        finishedAt: Date.now(),
        summary: result.summary,
      });
      this.emit(run.id, active, "done", result.summary, { status: result.status });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const status: RunStatus = active.controller.signal.aborted ? "cancelled" : "error";
      updateRun(run.id, { status, finishedAt: Date.now(), summary: message });
      this.emit(run.id, active, "error", message, { status });
      this.emit(run.id, active, "done", message, { status });
    } finally {
      // Keep the bus around briefly so late SSE subscribers can flush, then drop it.
      setTimeout(() => this.active.delete(run.id), 5000);
    }
  }
}

const g = globalThis as unknown as { __wizardOrchestrator?: Orchestrator };

export function getOrchestrator(): Orchestrator {
  if (!g.__wizardOrchestrator) g.__wizardOrchestrator = new Orchestrator();
  return g.__wizardOrchestrator;
}

/** Replay stored events then guarantees callers can resume the live stream. */
export function getStoredEvents(runId: string, afterId = 0): RunEvent[] {
  return listEvents(runId, afterId);
}

export function getRunSafe(runId: string): Run | null {
  return getRun(runId);
}
