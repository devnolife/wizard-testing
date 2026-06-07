import "server-only";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * A "testing guide" is an optional Markdown file the project author drops into
 * the target project to tell the wizard about things it cannot infer from code:
 * test accounts/credentials, which features exist, key flows to exercise, and
 * any constraints. When present it is injected into the agent prompt.
 *
 * Candidate locations (first match wins), relative to the project root.
 */
export const GUIDE_FILENAMES = [
  "wizard.md",
  ".wizard.md",
  ".wizard/testing.md",
  "docs/wizard.md",
] as const;

/** Hard cap so a huge guide can't blow up the prompt / token budget. */
const MAX_GUIDE_BYTES = 16 * 1024;

export interface TestingGuide {
  /** Project-relative path the guide was found at. */
  relPath: string;
  /** Guide contents (UTF-8, truncated to MAX_GUIDE_BYTES). */
  content: string;
  truncated: boolean;
}

/**
 * Look for a testing guide inside the target project. Returns null when none of
 * the known files exist. Only reads the fixed candidate paths, so it can never
 * read outside the project.
 */
export function readTestingGuide(projectPath: string): TestingGuide | null {
  for (const rel of GUIDE_FILENAMES) {
    const abs = join(projectPath, rel);
    if (!existsSync(abs)) continue;
    try {
      if (!statSync(abs).isFile()) continue;
      const buf = readFileSync(abs);
      const truncated = buf.byteLength > MAX_GUIDE_BYTES;
      const content = buf.subarray(0, MAX_GUIDE_BYTES).toString("utf8").trim();
      if (!content) continue;
      return { relPath: rel, content, truncated };
    } catch {
      continue;
    }
  }
  return null;
}
