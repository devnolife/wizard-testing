import { describe, it, expect } from "vitest";
import { safeFilename } from "@/server/tools/test-writer";

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
