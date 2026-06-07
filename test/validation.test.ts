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

  it("accepts a valid auth block", () => {
    const res = validateRunConfig({
      ...base,
      auth: { loginPath: "/login", username: "u@x.com", password: "secret" },
    });
    expect(res.ok).toBe(true);
    expect(res.config?.auth?.username).toBe("u@x.com");
  });

  it("rejects an auth block missing required fields", () => {
    const res = validateRunConfig({
      ...base,
      auth: { loginPath: "/login", username: "u@x.com" },
    });
    expect(res.ok).toBe(false);
  });

  it("accepts a config enabling only a new scope (e.g. performance)", () => {
    const res = validateRunConfig({
      ...base,
      scope: { ui: false, ux: false, api: false, performance: true },
    });
    expect(res.ok).toBe(true);
    expect(res.config?.scope.performance).toBe(true);
  });

  it("defaults unspecified scope keys to false", () => {
    const res = validateRunConfig({ ...base, scope: { ui: true, ux: false, api: false } });
    expect(res.ok).toBe(true);
    expect(res.config?.scope.security).toBe(false);
    expect(res.config?.scope.responsive).toBe(false);
    expect(res.config?.scope.console).toBe(false);
  });
});
