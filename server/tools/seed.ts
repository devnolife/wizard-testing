import "server-only";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, extname, basename } from "node:path";
import type { SeedAccount } from "@/lib/types";

/**
 * Detect seeded/test login accounts in a local project. Because the wizard only
 * ever targets locally-controlled projects, reading `.env` files, seed scripts
 * and fixtures for credentials is acceptable — it mirrors what the developer
 * already has on disk and lets the agent log in without manual setup.
 */

const ENV_FILES = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.test",
  ".env.test.local",
];

/** Directories that commonly hold seed data / fixtures. Scanned shallowly. */
const SEED_DIRS = [
  "prisma",
  "seed",
  "seeds",
  "db",
  "database",
  "scripts",
  "fixtures",
  "fixture",
  "test",
  "tests",
  "__tests__",
  "mock",
  "mocks",
  "config",
];

const SEED_NAME_RE = /seed|fixture|mock|demo|sample|account|user|cred|login|auth/i;
const CODE_EXT = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".sql"]);

const MAX_FILES = 80;
const MAX_FILE_BYTES = 512 * 1024;
const MAX_ACCOUNTS = 12;
const MAX_DEPTH = 2;

const SKIP_DIRS = new Set([
  "node_modules",
  ".next",
  ".git",
  "dist",
  "build",
  "coverage",
  ".turbo",
  ".cache",
]);

function readSafe(p: string): string | null {
  try {
    if (statSync(p).size > MAX_FILE_BYTES) return null;
    return readFileSync(p, "utf8");
  } catch {
    return null;
  }
}

function roleFromContext(prefix: string, identifier: string): string | undefined {
  const hay = `${prefix} ${identifier}`.toLowerCase();
  if (/admin|root|superuser|owner/.test(hay)) return "admin";
  if (/manager|staff|editor/.test(hay)) return "staff";
  if (/user|member|customer|demo|test/.test(hay)) return "user";
  return undefined;
}

/** Parse a `.env`-style file into a flat key/value map. */
export function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/^\s*export\s+/, "");
    const m = /^\s*([A-Za-z0-9_.]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (!m) continue;
    let v = m[2];
    const hash = v.indexOf(" #");
    if (hash >= 0 && !/["']/.test(v.slice(0, hash))) v = v.slice(0, hash).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'")) ||
      (v.startsWith("`") && v.endsWith("`"))
    ) {
      v = v.slice(1, -1);
    }
    out[m[1]] = v;
  }
  return out;
}

const ID_KEY_RE = /^(.*?)_?(EMAIL|USERNAME|USER|LOGIN|ACCOUNT)$/i;
const SECRET_KEY_RE = /^(.*?)_?(PASSWORD|PASSWD|PASS|PWD|SECRET)$/i;

/** Pair identifier/secret environment variables into seed accounts. */
export function envAccounts(env: Record<string, string>, source: string): SeedAccount[] {
  const ids: { prefix: string; key: string }[] = [];
  const secrets: { prefix: string; key: string }[] = [];
  for (const key of Object.keys(env)) {
    const sec = SECRET_KEY_RE.exec(key);
    if (sec) {
      secrets.push({ prefix: sec[1].toUpperCase(), key });
      continue;
    }
    const id = ID_KEY_RE.exec(key);
    if (id) ids.push({ prefix: id[1].toUpperCase(), key });
  }
  const accounts: SeedAccount[] = [];
  for (const id of ids) {
    let sec = secrets.find((s) => s.prefix === id.prefix);
    if (!sec && secrets.length === 1) sec = secrets[0];
    if (!sec) continue;
    const identifier = env[id.key];
    const secret = env[sec.key];
    if (identifier && secret) {
      accounts.push({ identifier, secret, role: roleFromContext(id.prefix, identifier), source });
    }
  }
  return accounts;
}

// identifier then password within a short window (object / config literals).
const ID_THEN_PASS =
  /(?:email|username|user|login)\s*[:=]\s*["'`]([^"'`]{3,120})["'`][\s\S]{0,160}?(?:password|passwd|pass|pwd)\s*[:=]\s*["'`]([^"'`]{1,120})["'`]/gi;
// password then identifier within a short window.
const PASS_THEN_ID =
  /(?:password|passwd|pass|pwd)\s*[:=]\s*["'`]([^"'`]{1,120})["'`][\s\S]{0,160}?(?:email|username|user|login)\s*[:=]\s*["'`]([^"'`]{3,120})["'`]/gi;
// "email@example.com", "password" tuples (SQL VALUES / array rows).
const EMAIL_PASS_TUPLE =
  /["'`]([^"'`@\s]{1,80}@[^"'`\s]{1,80}\.[^"'`\s]{2,20})["'`]\s*,\s*["'`]([^"'`]{1,120})["'`]/g;

/** Extract credential pairs from arbitrary source/SQL/JSON text. */
export function extractAccountsFromText(text: string, source: string): SeedAccount[] {
  const accounts: SeedAccount[] = [];
  const push = (identifier: string, secret: string) => {
    if (!identifier || !secret) return;
    if (/^(your|changeme|<|\$\{|process\.env|example)/i.test(secret)) return;
    accounts.push({ identifier, secret, role: roleFromContext("", identifier), source });
  };
  let m: RegExpExecArray | null;
  ID_THEN_PASS.lastIndex = 0;
  while ((m = ID_THEN_PASS.exec(text))) push(m[1], m[2]);
  PASS_THEN_ID.lastIndex = 0;
  while ((m = PASS_THEN_ID.exec(text))) push(m[2], m[1]);
  EMAIL_PASS_TUPLE.lastIndex = 0;
  while ((m = EMAIL_PASS_TUPLE.exec(text))) push(m[1], m[2]);
  return accounts;
}

function dedupe(accounts: SeedAccount[]): SeedAccount[] {
  const seen = new Set<string>();
  const out: SeedAccount[] = [];
  for (const a of accounts) {
    const key = `${a.identifier}\u0000${a.secret}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
  }
  return out;
}

function looksLikeSeedFile(name: string): boolean {
  return SEED_NAME_RE.test(name);
}

/** Collect candidate files to scan, bounded by depth/count. */
function collectFiles(projectPath: string, seedFile?: string): string[] {
  const files: string[] = [];

  for (const env of ENV_FILES) {
    const p = join(projectPath, env);
    if (existsSync(p)) files.push(p);
  }

  if (seedFile) {
    const p = join(projectPath, seedFile);
    try {
      if (existsSync(p)) {
        if (statSync(p).isDirectory()) walk(p, 0, files, true);
        else files.push(p);
      }
    } catch {
      /* ignore */
    }
  }

  for (const dir of SEED_DIRS) {
    const p = join(projectPath, dir);
    if (existsSync(p)) {
      try {
        if (statSync(p).isDirectory()) walk(p, 0, files, true);
      } catch {
        /* ignore */
      }
    }
  }

  // Root-level seed-ish files (e.g. seed.ts, accounts.json).
  walk(projectPath, MAX_DEPTH, files, false);

  return Array.from(new Set(files)).slice(0, MAX_FILES);

  function walk(dir: string, depth: number, out: string[], all: boolean) {
    if (out.length >= MAX_FILES) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries) {
      if (out.length >= MAX_FILES) return;
      if (name.startsWith(".") && !ENV_FILES.includes(name)) continue;
      const full = join(dir, name);
      let st;
      try {
        st = statSync(full);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        if (SKIP_DIRS.has(name)) continue;
        if (depth > 0 && (all || looksLikeSeedFile(name))) walk(full, depth - 1, out, all);
        else if (all && depth >= 0) walk(full, Math.max(depth - 1, 0), out, all);
        continue;
      }
      const ext = extname(name).toLowerCase();
      if (!CODE_EXT.has(ext)) continue;
      if (all || looksLikeSeedFile(basename(name))) out.push(full);
    }
  }
}

/**
 * Scan a local project for seeded/test login accounts. Returns a de-duplicated,
 * capped list. Never throws — returns [] on any error.
 */
export function detectSeedAccounts(projectPath: string, seedFile?: string): SeedAccount[] {
  try {
    const files = collectFiles(projectPath, seedFile);
    const all: SeedAccount[] = [];
    for (const file of files) {
      const text = readSafe(file);
      if (!text) continue;
      const source = relative(projectPath, file) || basename(file);
      if (ENV_FILES.includes(basename(file))) {
        all.push(...envAccounts(parseEnv(text), source));
      } else {
        all.push(...extractAccountsFromText(text, source));
      }
      if (all.length >= MAX_ACCOUNTS * 3) break;
    }
    return dedupe(all).slice(0, MAX_ACCOUNTS);
  } catch {
    return [];
  }
}

/** Mask a secret for display/logging (keep the feature local-safe in the UI). */
export function maskSecret(secret: string): string {
  if (secret.length <= 2) return "••";
  return secret[0] + "•".repeat(Math.min(secret.length - 2, 8)) + secret[secret.length - 1];
}
