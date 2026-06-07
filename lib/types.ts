// Shared types used by both server (orchestrator/tools) and client (dashboard UI).
// Keep this file free of any server-only imports so it can be used in the browser.

export type RunMode = "auto-start" | "url";
export type SaveMode = "ephemeral" | "project";

export type ScopeKey = "ui" | "ux" | "api";
export type Scope = Record<ScopeKey, boolean>;

/**
 * Optional credentials so the wizard can log into the target app before testing.
 * When provided, the wizard performs the login once (auto-detecting the form
 * fields when selectors are omitted) so every browser action runs authenticated.
 */
export interface AuthConfig {
  /** Path of the login page, e.g. /login. */
  loginPath: string;
  username: string;
  password: string;
  /** Optional explicit selectors; auto-detected when omitted. */
  usernameSelector?: string;
  passwordSelector?: string;
  submitSelector?: string;
}

export type RunStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "error"
  | "cancelled";

export type FindingCategory = "UI" | "UX" | "API" | "PROCESS";
export type Severity = "critical" | "major" | "minor" | "info";

export interface RunConfig {
  projectPath: string;
  mode: RunMode;
  /** Required when mode === "url" (e.g. http://localhost:3000). */
  url?: string;
  scope: Scope;
  saveMode: SaveMode;
  /** Folder (relative to projectPath) to write tests into when saveMode === "project". */
  saveDir?: string;
  /** Run the browser in a visible window (headed) so you can watch it live. */
  headed?: boolean;
  /** Optional login credentials; when set the wizard authenticates first. */
  auth?: AuthConfig;
}

export interface Run extends RunConfig {
  id: string;
  status: RunStatus;
  startedAt: number;
  finishedAt: number | null;
  tokenUsage: number;
  summary: string | null;
}

export interface Finding {
  id: string;
  runId: string;
  category: FindingCategory;
  title: string;
  severity: Severity;
  detail: string;
  screenshotPath: string | null;
  suggestion: string | null;
  createdAt: number;
}

export type ArtifactType = "screenshot" | "log" | "generated_test";

export interface Artifact {
  id: string;
  runId: string;
  type: ArtifactType;
  path: string;
  createdAt: number;
}

export type RunEventKind =
  | "status"
  | "step"
  | "tool"
  | "finding"
  | "screenshot"
  | "live_frame"
  | "log"
  | "error"
  | "done";

export interface RunEvent {
  id: number;
  runId: string;
  ts: number;
  kind: RunEventKind;
  message: string;
  payload: Record<string, unknown> | null;
}

export interface RunReport {
  run: Run;
  findings: Finding[];
  artifacts: Artifact[];
}
