import "server-only";
import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Run,
  RunConfig,
  RunStatus,
  Finding,
  FindingCategory,
  Severity,
  Artifact,
  ArtifactType,
  RunEvent,
  RunEventKind,
  RunReport,
} from "@/lib/types";

export const DATA_DIR = join(process.cwd(), ".wizard-data");
export const ARTIFACTS_DIR = join(DATA_DIR, "artifacts");
const DB_PATH = join(DATA_DIR, "wizard.db");

// Cache the connection on globalThis so dev hot-reload does not open many handles.
const g = globalThis as unknown as { __wizardDb?: Database.Database };

export function getDb(): Database.Database {
  if (g.__wizardDb) return g.__wizardDb;
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  initSchema(db);
  g.__wizardDb = db;
  return db;
}

function initSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      project_path TEXT NOT NULL,
      mode TEXT NOT NULL,
      url TEXT,
      scope TEXT NOT NULL,
      save_mode TEXT NOT NULL,
      save_dir TEXT,
      status TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      token_usage INTEGER NOT NULL DEFAULT 0,
      summary TEXT
    );

    CREATE TABLE IF NOT EXISTS findings (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id),
      category TEXT NOT NULL,
      title TEXT NOT NULL,
      severity TEXT NOT NULL,
      detail TEXT NOT NULL,
      screenshot_path TEXT,
      suggestion TEXT,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL REFERENCES runs(id),
      type TEXT NOT NULL,
      path TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL REFERENCES runs(id),
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      message TEXT NOT NULL,
      payload TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_findings_run ON findings(run_id);
    CREATE INDEX IF NOT EXISTS idx_artifacts_run ON artifacts(run_id);
    CREATE INDEX IF NOT EXISTS idx_events_run ON events(run_id);
  `);
}

/* ---------- Runs ---------- */

export function createRun(config: RunConfig): Run {
  const db = getDb();
  const run: Run = {
    id: randomUUID(),
    ...config,
    status: "pending",
    startedAt: Date.now(),
    finishedAt: null,
    tokenUsage: 0,
    summary: null,
  };
  db.prepare(
    `INSERT INTO runs (id, project_path, mode, url, scope, save_mode, save_dir, status, started_at, finished_at, token_usage, summary)
     VALUES (@id, @projectPath, @mode, @url, @scope, @saveMode, @saveDir, @status, @startedAt, @finishedAt, @tokenUsage, @summary)`,
  ).run({
    ...run,
    url: run.url ?? null,
    saveDir: run.saveDir ?? null,
    scope: JSON.stringify(run.scope),
    finishedAt: run.finishedAt,
    summary: run.summary,
  });
  return run;
}

export function updateRun(
  id: string,
  patch: Partial<Pick<Run, "status" | "finishedAt" | "tokenUsage" | "summary">>,
): void {
  const db = getDb();
  const sets: string[] = [];
  const params: Record<string, unknown> = { id };
  if (patch.status !== undefined) {
    sets.push("status = @status");
    params.status = patch.status;
  }
  if (patch.finishedAt !== undefined) {
    sets.push("finished_at = @finishedAt");
    params.finishedAt = patch.finishedAt;
  }
  if (patch.tokenUsage !== undefined) {
    sets.push("token_usage = @tokenUsage");
    params.tokenUsage = patch.tokenUsage;
  }
  if (patch.summary !== undefined) {
    sets.push("summary = @summary");
    params.summary = patch.summary;
  }
  if (sets.length === 0) return;
  db.prepare(`UPDATE runs SET ${sets.join(", ")} WHERE id = @id`).run(params);
}

interface RunRow {
  id: string;
  project_path: string;
  mode: string;
  url: string | null;
  scope: string;
  save_mode: string;
  save_dir: string | null;
  status: string;
  started_at: number;
  finished_at: number | null;
  token_usage: number;
  summary: string | null;
}

function rowToRun(r: RunRow): Run {
  return {
    id: r.id,
    projectPath: r.project_path,
    mode: r.mode as Run["mode"],
    url: r.url ?? undefined,
    scope: JSON.parse(r.scope),
    saveMode: r.save_mode as Run["saveMode"],
    saveDir: r.save_dir ?? undefined,
    status: r.status as RunStatus,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
    tokenUsage: r.token_usage,
    summary: r.summary,
  };
}

export function getRun(id: string): Run | null {
  const row = getDb().prepare("SELECT * FROM runs WHERE id = ?").get(id) as
    | RunRow
    | undefined;
  return row ? rowToRun(row) : null;
}

export function listRuns(limit = 50): Run[] {
  const rows = getDb()
    .prepare("SELECT * FROM runs ORDER BY started_at DESC LIMIT ?")
    .all(limit) as RunRow[];
  return rows.map(rowToRun);
}

/* ---------- Findings ---------- */

export function addFinding(
  runId: string,
  f: {
    category: FindingCategory;
    title: string;
    severity: Severity;
    detail: string;
    screenshotPath?: string | null;
    suggestion?: string | null;
  },
): Finding {
  const finding: Finding = {
    id: randomUUID(),
    runId,
    category: f.category,
    title: f.title,
    severity: f.severity,
    detail: f.detail,
    screenshotPath: f.screenshotPath ?? null,
    suggestion: f.suggestion ?? null,
    createdAt: Date.now(),
  };
  getDb()
    .prepare(
      `INSERT INTO findings (id, run_id, category, title, severity, detail, screenshot_path, suggestion, created_at)
       VALUES (@id, @runId, @category, @title, @severity, @detail, @screenshotPath, @suggestion, @createdAt)`,
    )
    .run(finding);
  return finding;
}

interface FindingRow {
  id: string;
  run_id: string;
  category: string;
  title: string;
  severity: string;
  detail: string;
  screenshot_path: string | null;
  suggestion: string | null;
  created_at: number;
}

export function listFindings(runId: string): Finding[] {
  const rows = getDb()
    .prepare("SELECT * FROM findings WHERE run_id = ? ORDER BY created_at ASC")
    .all(runId) as FindingRow[];
  return rows.map((r) => ({
    id: r.id,
    runId: r.run_id,
    category: r.category as FindingCategory,
    title: r.title,
    severity: r.severity as Severity,
    detail: r.detail,
    screenshotPath: r.screenshot_path,
    suggestion: r.suggestion,
    createdAt: r.created_at,
  }));
}

/* ---------- Artifacts ---------- */

export function addArtifact(
  runId: string,
  type: ArtifactType,
  path: string,
): Artifact {
  const artifact: Artifact = {
    id: randomUUID(),
    runId,
    type,
    path,
    createdAt: Date.now(),
  };
  getDb()
    .prepare(
      `INSERT INTO artifacts (id, run_id, type, path, created_at)
       VALUES (@id, @runId, @type, @path, @createdAt)`,
    )
    .run(artifact);
  return artifact;
}

interface ArtifactRow {
  id: string;
  run_id: string;
  type: string;
  path: string;
  created_at: number;
}

export function listArtifacts(runId: string): Artifact[] {
  const rows = getDb()
    .prepare("SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at ASC")
    .all(runId) as ArtifactRow[];
  return rows.map((r) => ({
    id: r.id,
    runId: r.run_id,
    type: r.type as ArtifactType,
    path: r.path,
    createdAt: r.created_at,
  }));
}

/* ---------- Events ---------- */

export function addEvent(
  runId: string,
  kind: RunEventKind,
  message: string,
  payload?: Record<string, unknown> | null,
): RunEvent {
  const ts = Date.now();
  const info = getDb()
    .prepare(
      `INSERT INTO events (run_id, ts, kind, message, payload)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .run(runId, ts, kind, message, payload ? JSON.stringify(payload) : null);
  return {
    id: Number(info.lastInsertRowid),
    runId,
    ts,
    kind,
    message,
    payload: payload ?? null,
  };
}

interface EventRow {
  id: number;
  run_id: string;
  ts: number;
  kind: string;
  message: string;
  payload: string | null;
}

export function listEvents(runId: string, afterId = 0): RunEvent[] {
  const rows = getDb()
    .prepare(
      "SELECT * FROM events WHERE run_id = ? AND id > ? ORDER BY id ASC",
    )
    .all(runId, afterId) as EventRow[];
  return rows.map((r) => ({
    id: r.id,
    runId: r.run_id,
    ts: r.ts,
    kind: r.kind as RunEventKind,
    message: r.message,
    payload: r.payload ? JSON.parse(r.payload) : null,
  }));
}

export function getReport(runId: string): RunReport | null {
  const run = getRun(runId);
  if (!run) return null;
  return {
    run,
    findings: listFindings(runId),
    artifacts: listArtifacts(runId),
  };
}
