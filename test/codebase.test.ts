import { describe, it, expect } from "vitest";
import { join } from "node:path";
import { discoverApp, readProjectFile } from "@/server/tools/codebase";

const FIXTURE = join(process.cwd(), "fixtures", "sample-next-app");

describe("discoverApp", () => {
  const map = discoverApp(FIXTURE);

  it("finds UI pages", () => {
    expect(map.pages).toContain("/");
    expect(map.pages).toContain("/login");
    expect(map.pages).toContain("/broken");
  });

  it("finds API routes", () => {
    expect(map.apiRoutes).toContain("/api/health");
    expect(map.apiRoutes).toContain("/api/users");
    expect(map.apiRoutes).toContain("/api/broken");
  });

  it("does not classify pages as API routes", () => {
    expect(map.apiRoutes).not.toContain("/login");
  });
});

describe("readProjectFile", () => {
  it("reads a file inside the project", () => {
    const { content } = readProjectFile(FIXTURE, "package.json");
    expect(content).toContain("sample-next-app");
  });

  it("blocks path traversal", () => {
    expect(() => readProjectFile(FIXTURE, "../../package.json")).toThrow();
  });
});
