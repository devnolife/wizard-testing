import { describe, it, expect } from "vitest";
import { statusColor, severityColor, formatDuration } from "@/lib/format";

describe("format helpers", () => {
  it("colors status by outcome", () => {
    expect(statusColor("passed")).toContain("green");
    expect(statusColor("failed")).toContain("red");
    expect(statusColor("running")).toContain("blue");
  });

  it("colors severity", () => {
    expect(severityColor("critical")).toContain("red");
    expect(severityColor("info")).toContain("sky");
  });

  it("formats duration", () => {
    expect(formatDuration(0, null)).toBe("in progress");
    expect(formatDuration(0, 5000)).toBe("5s");
    expect(formatDuration(0, 65000)).toBe("1m 5s");
  });
});
