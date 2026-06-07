import "server-only";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DATA_DIR } from "./db";

/** Root dir for stored visual baselines. */
export const BASELINES_DIR = join(DATA_DIR, "baselines");

function projectHash(projectPath: string): string {
  return createHash("sha1").update(projectPath).digest("hex").slice(0, 16);
}

/** Turn a free-form label/route into a safe, stable filename key. */
export function routeKey(label: string): string {
  const slug = label
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\/[^/]+/, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "root";
}

function baselineDir(projectPath: string): string {
  const dir = join(BASELINES_DIR, projectHash(projectPath));
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Absolute path to the baseline PNG for a (project, route). */
export function baselinePath(projectPath: string, key: string): string {
  return join(baselineDir(projectPath), `${key}.png`);
}

export function hasBaseline(projectPath: string, key: string): boolean {
  return existsSync(baselinePath(projectPath, key));
}

export function readBaseline(projectPath: string, key: string): Buffer {
  return readFileSync(baselinePath(projectPath, key));
}

/** Save (or overwrite) the baseline image for a (project, route). */
export function saveBaseline(projectPath: string, key: string, png: Buffer): string {
  const path = baselinePath(projectPath, key);
  writeFileSync(path, png);
  return path;
}

/* ---------- Auth session reuse (storageState) ---------- */

export const SESSIONS_DIR = join(DATA_DIR, "sessions");

/** Absolute path to the saved Playwright storageState for a project. */
export function sessionStatePath(projectPath: string): string {
  mkdirSync(SESSIONS_DIR, { recursive: true });
  return join(SESSIONS_DIR, `${projectHash(projectPath)}.json`);
}

/** Whether a fresh (younger than maxAgeMs) saved session exists. */
export function hasFreshSession(projectPath: string, maxAgeMs = 12 * 60 * 60 * 1000): boolean {
  const p = sessionStatePath(projectPath);
  if (!existsSync(p)) return false;
  try {
    return Date.now() - statSync(p).mtimeMs < maxAgeMs;
  } catch {
    return false;
  }
}
