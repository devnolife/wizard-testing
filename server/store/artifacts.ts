import "server-only";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { ARTIFACTS_DIR } from "./db";

/** Absolute directory holding artifacts for a single run. */
export function runArtifactDir(runId: string): string {
  const dir = join(ARTIFACTS_DIR, runId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Persist a screenshot (PNG bytes) and return its absolute path. */
export function writeScreenshot(runId: string, data: Buffer, label?: string): string {
  const dir = runArtifactDir(runId);
  const name = `${Date.now()}-${(label ?? "shot").replace(/[^a-z0-9-_]/gi, "_")}-${randomUUID().slice(0, 8)}.png`;
  const path = join(dir, name);
  writeFileSync(path, data);
  return path;
}

/** Persist a text log and return its absolute path. */
export function writeLog(runId: string, content: string, label = "log"): string {
  const dir = runArtifactDir(runId);
  const name = `${Date.now()}-${label.replace(/[^a-z0-9-_]/gi, "_")}.log`;
  const path = join(dir, name);
  writeFileSync(path, content, "utf8");
  return path;
}

/** Persist a generated test file inside the run's artifact dir (ephemeral copy). */
export function writeGeneratedTest(runId: string, filename: string, content: string): string {
  const dir = join(runArtifactDir(runId), "tests");
  mkdirSync(dir, { recursive: true });
  const path = join(dir, filename);
  writeFileSync(path, content, "utf8");
  return path;
}
