import { describe, it, expect, afterAll } from "vitest";
import { join } from "node:path";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { discoverApp, readProjectFile, detectFramework } from "@/server/tools/codebase";

const FIXTURE = join(process.cwd(), "fixtures", "sample-next-app");

const tmpDirs: string[] = [];
function makeProject(pkg: Record<string, unknown>, files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "wizard-fw-"));
  tmpDirs.push(dir);
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(dir, rel);
    mkdirSync(join(abs, ".."), { recursive: true });
    writeFileSync(abs, content);
  }
  return dir;
}

afterAll(() => {
  for (const d of tmpDirs) rmSync(d, { recursive: true, force: true });
});

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

  it("detects the Next.js framework", () => {
    expect(map.framework).toBe("nextjs");
  });
});

describe("detectFramework", () => {
  it("detects Next.js and a dev script", () => {
    const info = detectFramework(FIXTURE);
    expect(info.framework).toBe("nextjs");
    expect(["dev", "start"]).toContain(info.devScript);
  });

  it("detects SvelteKit / Remix / Astro / Nuxt / Vite / CRA from deps", () => {
    expect(detectFramework(makeProject({ dependencies: { "@sveltejs/kit": "2" } }, {})).framework).toBe("sveltekit");
    expect(detectFramework(makeProject({ dependencies: { "@remix-run/react": "2" } }, {})).framework).toBe("remix");
    expect(detectFramework(makeProject({ dependencies: { astro: "4" } }, {})).framework).toBe("astro");
    expect(detectFramework(makeProject({ dependencies: { nuxt: "3" } }, {})).framework).toBe("nuxt");
    expect(detectFramework(makeProject({ devDependencies: { vite: "5" } }, {})).framework).toBe("vite");
    expect(detectFramework(makeProject({ dependencies: { "react-scripts": "5" } }, {})).framework).toBe("cra");
  });

  it("prefers the dev script, falling back to start", () => {
    expect(detectFramework(makeProject({ scripts: { dev: "x", start: "y" } }, {})).devScript).toBe("dev");
    expect(detectFramework(makeProject({ scripts: { start: "y" } }, {})).devScript).toBe("start");
    expect(detectFramework(makeProject({}, {})).devScript).toBeNull();
  });
});

describe("discoverApp — non-Next frameworks", () => {
  it("maps SvelteKit routes (+page.svelte / +server.ts)", () => {
    const dir = makeProject(
      { dependencies: { "@sveltejs/kit": "2" } },
      {
        "src/routes/+page.svelte": "x",
        "src/routes/about/+page.svelte": "x",
        "src/routes/blog/[slug]/+page.svelte": "x",
        "src/routes/api/health/+server.ts": "x",
      },
    );
    const map = discoverApp(dir);
    expect(map.framework).toBe("sveltekit");
    expect(map.pages).toEqual(expect.arrayContaining(["/", "/about", "/blog/:slug"]));
    expect(map.apiRoutes).toContain("/api/health");
  });

  it("maps Remix flat routes (dots → slashes, $ params)", () => {
    const dir = makeProject(
      { dependencies: { "@remix-run/react": "2" } },
      {
        "app/routes/_index.tsx": "x",
        "app/routes/about.tsx": "x",
        "app/routes/users.$id.tsx": "x",
      },
    );
    const map = discoverApp(dir);
    expect(map.framework).toBe("remix");
    expect(map.pages).toEqual(expect.arrayContaining(["/", "/about", "/users/:id"]));
  });

  it("maps Astro pages (index + dynamic)", () => {
    const dir = makeProject(
      { dependencies: { astro: "4" } },
      { "src/pages/index.astro": "x", "src/pages/blog/[slug].astro": "x" },
    );
    const map = discoverApp(dir);
    expect(map.framework).toBe("astro");
    expect(map.pages).toEqual(expect.arrayContaining(["/", "/blog/:slug"]));
  });

  it("falls back to / with a note for client-rendered SPAs", () => {
    const dir = makeProject({ devDependencies: { vite: "5" } }, { "src/main.tsx": "x" });
    const map = discoverApp(dir);
    expect(map.framework).toBe("vite");
    expect(map.pages).toEqual(["/"]);
    expect(map.note).toBeTruthy();
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
