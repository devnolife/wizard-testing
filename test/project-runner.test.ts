import { describe, it, expect } from "vitest";
import { join } from "node:path";
import type { RunContext } from "@/server/orchestrator";
import {
  ProjectRunner,
  AppUnavailableError,
  detectPackageManager,
  parseUrlFromOutput,
  findFreePort,
} from "@/server/tools/project-runner";

const FIXTURE = join(process.cwd(), "fixtures", "sample-next-app");

function stubContext(): RunContext {
  return {
    run: {} as RunContext["run"],
    signal: new AbortController().signal,
    emit: () => {},
    step: () => {},
    tool: () => {},
    finding: () => {},
    screenshot: () => "",
    log: () => "",
    addTokens: () => {},
  };
}

describe("parseUrlFromOutput", () => {
  it("extracts a localhost URL with port", () => {
    expect(parseUrlFromOutput("- Local: http://localhost:3001")).toBe("http://localhost:3001");
  });

  it("extracts a 127.0.0.1 URL", () => {
    expect(parseUrlFromOutput("ready on https://127.0.0.1:4100/")).toBe("https://127.0.0.1:4100");
  });

  it("returns null when no local URL is present", () => {
    expect(parseUrlFromOutput("compiled successfully")).toBeNull();
    expect(parseUrlFromOutput("visit http://example.com")).toBeNull();
  });
});

describe("detectPackageManager", () => {
  it("defaults to npm when no lockfile matches", () => {
    expect(detectPackageManager(FIXTURE)).toBe("npm");
  });
});

describe("findFreePort", () => {
  it("returns a usable TCP port number", async () => {
    const port = await findFreePort();
    expect(port).toBeGreaterThan(0);
    expect(port).toBeLessThan(65536);
  });
});

describe("ProjectRunner guardrails", () => {
  it("rejects URL mode without a URL", async () => {
    const runner = new ProjectRunner(FIXTURE, stubContext());
    await expect(runner.ensureRunning({ mode: "url" })).rejects.toBeInstanceOf(
      AppUnavailableError,
    );
  });

  it("refuses to auto-start a non-allowlisted script", async () => {
    const runner = new ProjectRunner(FIXTURE, stubContext());
    await expect(
      runner.ensureRunning({ mode: "auto-start", script: "build" }),
    ).rejects.toThrow(/not allowed/i);
  });
});
