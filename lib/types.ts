// Shared types used by both server (orchestrator/tools) and client (dashboard UI).
// Keep this file free of any server-only imports so it can be used in the browser.

export type RunMode = "auto-start" | "url";
export type SaveMode = "ephemeral" | "project";

export type ScopeKey =
  | "ui"
  | "ux"
  | "api"
  | "performance"
  | "accessibility"
  | "seo"
  | "visual"
  | "security"
  | "responsive"
  | "links"
  | "console";
export type Scope = Record<ScopeKey, boolean>;

/** Metadata for each test scope — drives the New Run form UI. */
export interface ScopeMeta {
  key: ScopeKey;
  label: string;
  description: string;
  /** Default-checked in the New Run form. */
  defaultOn: boolean;
}

export const SCOPE_META: ScopeMeta[] = [
  { key: "ui", label: "UI", description: "Pages render, navigation & user flows work", defaultOn: true },
  { key: "ux", label: "UX", description: "Usability heuristics, clear errors/feedback, no dead-ends", defaultOn: true },
  { key: "api", label: "API", description: "Endpoint status codes, payloads & error handling", defaultOn: true },
  { key: "performance", label: "Performance", description: "Lighthouse score & Core Web Vitals (FCP, LCP, TBT, CLS)", defaultOn: false },
  { key: "accessibility", label: "Accessibility", description: "Deep WCAG 2 A/AA audit (axe-core + Lighthouse a11y)", defaultOn: false },
  { key: "seo", label: "SEO", description: "Titles, meta tags, headings & Lighthouse SEO score", defaultOn: false },
  { key: "visual", label: "Visual regression", description: "Baseline & pixel-diff key pages to catch visual changes", defaultOn: false },
  { key: "security", label: "Security", description: "Security headers, secret/error leakage, unauth access", defaultOn: false },
  { key: "responsive", label: "Responsive", description: "Layout at mobile, tablet & desktop widths (overflow/breakage)", defaultOn: false },
  { key: "links", label: "Links", description: "Crawl internal links to find broken/dead routes", defaultOn: false },
  { key: "console", label: "Console errors", description: "Catch console errors & uncaught JS exceptions", defaultOn: false },
];

export const SCOPE_KEYS: ScopeKey[] = SCOPE_META.map((m) => m.key);

/** A fresh Scope with each key set to its form default. */
export function defaultScope(): Scope {
  return SCOPE_META.reduce((acc, m) => {
    acc[m.key] = m.defaultOn;
    return acc;
  }, {} as Scope);
}

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

/**
 * A login credential discovered by scanning the local project's seed scripts,
 * `.env` files, fixtures or SQL. Safe to surface because the wizard only runs
 * against locally-controlled projects.
 */
export interface SeedAccount {
  /** Email or username used to log in. */
  identifier: string;
  /** Password / secret paired with the identifier. */
  secret: string;
  /** Detected role, when discernible (e.g. "admin", "user"). */
  role?: string;
  /** Project-relative file the credential was found in. */
  source: string;
}

export type RunStatus =
  | "pending"
  | "running"
  | "passed"
  | "failed"
  | "error"
  | "cancelled";

export type FindingCategory =
  | "UI"
  | "UX"
  | "API"
  | "PROCESS"
  | "PERF"
  | "A11Y"
  | "SEO"
  | "SECURITY"
  | "VISUAL";
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
  /**
   * Scan the local project for seeded/test login accounts (.env, seed scripts,
   * fixtures) and make them available to the agent. Defaults to on.
   */
  detectSeed?: boolean;
  /** Optional explicit seed file/folder (relative to projectPath) to prioritise. */
  seedFile?: string;
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
