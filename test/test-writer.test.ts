import { describe, it, expect } from "vitest";
import { safeFilename, parsePlaywrightSummary } from "@/server/tools/test-writer";

describe("safeFilename", () => {
  it("keeps valid spec names", () => {
    expect(safeFilename("login.spec.ts")).toBe("login.spec.ts");
    expect(safeFilename("api.test.ts")).toBe("api.test.ts");
  });

  it("appends .spec.ts to plain names", () => {
    expect(safeFilename("checkout")).toBe("checkout.spec.ts");
    expect(safeFilename("flow.ts")).toBe("flow.spec.ts");
  });

  it("strips directory components", () => {
    expect(safeFilename("nested/login.spec.ts")).toBe("login.spec.ts");
  });

  it("rejects names with unsafe characters", () => {
    expect(() => safeFilename("bad name!.ts")).toThrow();
  });
});

describe("parsePlaywrightSummary", () => {
  it("reads passed-only summaries", () => {
    expect(parsePlaywrightSummary("  10 passed (12.3s)")).toEqual({
      passed: 10,
      failed: 0,
      flaky: 0,
      skipped: 0,
    });
  });

  it("detects flaky and failed counts", () => {
    const out = [
      "  1 failed",
      "    [chromium] › login.spec.ts:3:1 › login works",
      "  2 flaky",
      "    [chromium] › cart.spec.ts:5:1 › add to cart",
      "  3 passed (8.1s)",
    ].join("\n");
    expect(parsePlaywrightSummary(out)).toEqual({
      passed: 3,
      failed: 1,
      flaky: 2,
      skipped: 0,
    });
  });

  it("reads skipped counts and defaults missing tokens to 0", () => {
    expect(parsePlaywrightSummary("  2 skipped\n  8 passed (9s)")).toEqual({
      passed: 8,
      failed: 0,
      flaky: 0,
      skipped: 2,
    });
  });

  it("returns all zeros for unrecognized output", () => {
    expect(parsePlaywrightSummary("no tests found")).toEqual({
      passed: 0,
      failed: 0,
      flaky: 0,
      skipped: 0,
    });
  });
});
