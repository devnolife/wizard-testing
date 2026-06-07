import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { readTestingGuide } from "@/server/tools/guide";

const FIXTURE = join(process.cwd(), "fixtures", "sample-next-app");
const REPO_ROOT = process.cwd();

describe("readTestingGuide", () => {
  it("loads wizard.md from a project that has one", () => {
    const guide = readTestingGuide(FIXTURE);
    expect(guide).not.toBeNull();
    expect(guide!.relPath).toBe("wizard.md");
    expect(guide!.content).toMatch(/Test accounts/i);
    expect(guide!.truncated).toBe(false);
  });

  it("returns null when no guide file exists", () => {
    // The repo root only has wizard.template.md, which is NOT a detected name.
    expect(readTestingGuide(REPO_ROOT)).toBeNull();
  });
});
