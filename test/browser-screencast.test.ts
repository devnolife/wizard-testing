import { describe, it, expect } from "vitest";
import { shouldEmitFrame } from "@/server/tools/browser";

describe("shouldEmitFrame", () => {
  it("emits when at least the interval has elapsed", () => {
    expect(shouldEmitFrame(1000, 1150, 150)).toBe(true);
    expect(shouldEmitFrame(1000, 2000, 150)).toBe(true);
  });

  it("skips when called again too soon", () => {
    expect(shouldEmitFrame(1000, 1100, 150)).toBe(false);
    expect(shouldEmitFrame(1000, 1000, 150)).toBe(false);
  });

  it("always emits the first real frame (lastAt = 0, real clock)", () => {
    expect(shouldEmitFrame(0, Date.now(), 150)).toBe(true);
  });
});
