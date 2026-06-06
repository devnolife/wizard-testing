import { describe, it, expect } from "vitest";
import { validateRunConfig } from "@/server/validation";

const base = {
  projectPath: process.cwd(),
  mode: "auto-start" as const,
  scope: { ui: true, ux: false, api: false },
  saveMode: "ephemeral" as const,
};

describe("validateRunConfig", () => {
  it("accepts a valid config", () => {
    const res = validateRunConfig(base);
    expect(res.ok).toBe(true);
  });

  it("requires at least one scope", () => {
    const res = validateRunConfig({ ...base, scope: { ui: false, ux: false, api: false } });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/scope/i);
  });

  it("requires a url in url mode", () => {
    const res = validateRunConfig({ ...base, mode: "url" });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/url/i);
  });

  it("rejects a non-existent project path", () => {
    const res = validateRunConfig({ ...base, projectPath: "Z:/definitely/not/here" });
    expect(res.ok).toBe(false);
  });
});
