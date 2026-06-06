import { describe, it, expect } from "vitest";
import { apiRequest } from "@/server/tools/http";

const signal = new AbortController().signal;

describe("apiRequest guardrails", () => {
  it("refuses non-local hosts", async () => {
    const res = await apiRequest("http://localhost:3000", { path: "http://example.com/x" }, signal);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/non-local/i);
  });

  it("rejects disallowed methods", async () => {
    const res = await apiRequest("http://localhost:3000", { path: "/x", method: "TRACE" }, signal);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/not allowed/i);
  });

  it("refuses protocol-relative external hosts", async () => {
    const res = await apiRequest("http://localhost:3000", { path: "//example.com/x" }, signal);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/non-local/i);
  });
});
