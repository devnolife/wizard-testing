import "server-only";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export type Framework =
  | "nextjs"
  | "sveltekit"
  | "remix"
  | "astro"
  | "nuxt"
  | "vite"
  | "cra"
  | "unknown";

export interface FrameworkInfo {
  framework: Framework;
  /** The npm script to launch the dev server ("dev" or "start"), or null. */
  devScript: string | null;
}

export interface AppMap {
  framework: Framework;
  pages: string[];
  apiRoutes: string[];
  rootDirs: string[];
  /** Best-effort note when routes could not be mapped statically. */
  note?: string;
}

const IGNORE = new Set(["node_modules", ".next", ".git", ".wizard-data", "dist", "build"]);

function walk(dir: string, onFile: (abs: string) => void, depth = 0) {
  if (depth > 12 || !existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (IGNORE.has(entry)) continue;
    const abs = join(dir, entry);
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) walk(abs, onFile, depth + 1);
    else onFile(abs);
  }
}

/** Read and parse the project's package.json (returns {} when missing/invalid). */
function readPackageJson(projectPath: string): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(join(projectPath, "package.json"), "utf8"));
  } catch {
    return {};
  }
}

/** Detect the frontend framework + which dev script to run, from package.json. */
export function detectFramework(projectPath: string): FrameworkInfo {
  const pkg = readPackageJson(projectPath);
  const deps = {
    ...((pkg.dependencies as Record<string, string>) ?? {}),
    ...((pkg.devDependencies as Record<string, string>) ?? {}),
  };
  const has = (name: string) => Object.prototype.hasOwnProperty.call(deps, name);
  const scripts = (pkg.scripts as Record<string, string>) ?? {};

  let framework: Framework = "unknown";
  if (has("next")) framework = "nextjs";
  else if (has("@sveltejs/kit")) framework = "sveltekit";
  else if (Object.keys(deps).some((d) => d.startsWith("@remix-run/"))) framework = "remix";
  else if (has("astro")) framework = "astro";
  else if (has("nuxt") || has("nuxt3")) framework = "nuxt";
  else if (has("react-scripts")) framework = "cra";
  else if (has("vite")) framework = "vite";

  const devScript = scripts.dev ? "dev" : scripts.start ? "start" : null;
  return { framework, devScript };
}

// --- Route mapping helpers (one per convention) -----------------------------

/** Map a single dynamic segment to a readable param form. */
function mapDynamic(seg: string): string {
  return seg
    .replace(/^\[\.\.\.(.+)\]$/, "*")
    .replace(/^\[\[(.+)\]\]$/, ":$1?")
    .replace(/^\[(.+)\]$/, ":$1");
}

/** Next.js app-router: page.tsx / route.ts. */
function nextAppRoute(rel: string): { route: string; api: boolean } | null {
  const parts = rel.split("/");
  const file = parts.pop()!;
  if (!/^(page|route)\.(t|j)sx?$/.test(file)) return null;
  const segs = parts
    .filter((p) => !(p.startsWith("(") && p.endsWith(")")))
    .map(mapDynamic);
  return { route: "/" + segs.join("/"), api: /^route\./.test(file) };
}

/** Next.js / generic pages-router-style mapping with configurable extensions. */
function pagesStyleRoute(rel: string, extRe: RegExp): string | null {
  if (!extRe.test(rel)) return null;
  const parts = rel.split("/");
  const file = parts.pop()!;
  if (file.startsWith("_")) return null;
  const name = file.replace(extRe, "");
  const segs = parts.map(mapDynamic);
  if (name !== "index") segs.push(mapDynamic(name));
  return "/" + segs.filter(Boolean).join("/");
}

/** SvelteKit: src/routes with +page.svelte (page) / +server.ts (endpoint). */
function svelteKitRoute(rel: string): { route: string; api: boolean } | null {
  const parts = rel.split("/");
  const file = parts.pop()!;
  const isPage = file === "+page.svelte";
  const isServer = /^\+server\.(t|j)s$/.test(file);
  if (!isPage && !isServer) return null;
  const segs = parts
    .filter((p) => !(p.startsWith("(") && p.endsWith(")")))
    .map((p) => p.replace(/^\[\.\.\.(.+)\]$/, "*").replace(/^\[(.+)\]$/, ":$1"));
  return { route: "/" + segs.join("/"), api: isServer };
}

/** Remix v2 flat routes: dots become slashes, $ params, _index → index. */
function remixRoute(rel: string): string | null {
  const parts = rel.split("/");
  const file = parts.pop()!;
  if (!/\.(t|j)sx?$/.test(file)) return null;
  if (/\.(css|server|client)\./.test(file)) return null;
  const name = file.replace(/\.(t|j)sx?$/, "");
  const dirSegs = parts.map((p) => (p.startsWith("$") ? ":" + p.slice(1) : p));
  const out: string[] = [...dirSegs];
  for (const s of name.split(".")) {
    if (s === "" || s === "_index") continue;
    if (s.startsWith("_")) continue; // pathless layout segment
    if (s === "$") out.push("*");
    else if (s.startsWith("$")) out.push(":" + s.slice(1));
    else out.push(s);
  }
  return "/" + out.join("/");
}

interface RouteSource {
  root: string;
  collect: (rel: string, add: (route: string, api: boolean) => void) => void;
}

function sourcesFor(framework: Framework): RouteSource[] {
  switch (framework) {
    case "sveltekit":
      return [
        {
          root: "src/routes",
          collect: (rel, add) => {
            const r = svelteKitRoute(rel);
            if (r) add(r.route, r.api);
          },
        },
      ];
    case "remix":
      return [
        {
          root: "app/routes",
          collect: (rel, add) => {
            const r = remixRoute(rel);
            if (r) add(r, false);
          },
        },
      ];
    case "astro":
      return [
        {
          root: "src/pages",
          collect: (rel, add) => {
            const r = pagesStyleRoute(rel, /\.(astro|md|mdx|html|tsx?|jsx?)$/);
            if (r) add(r, /\.(t|j)s$/.test(rel));
          },
        },
      ];
    case "nuxt":
      return [
        {
          root: "pages",
          collect: (rel, add) => {
            const r = pagesStyleRoute(rel, /\.vue$/);
            if (r) add(r, false);
          },
        },
      ];
    case "nextjs":
    default:
      return [
        ...["app", "src/app"].map((root) => ({
          root,
          collect: (rel: string, add: (route: string, api: boolean) => void) => {
            const r = nextAppRoute(rel);
            if (r) add(r.route, r.api);
          },
        })),
        ...["pages", "src/pages"].map((root) => ({
          root,
          collect: (rel: string, add: (route: string, api: boolean) => void) => {
            const r = pagesStyleRoute(rel, /\.(t|j)sx?$/);
            if (r) add(r, r.startsWith("/api"));
          },
        })),
      ];
  }
}

export function discoverApp(projectPath: string): AppMap {
  const { framework } = detectFramework(projectPath);
  const pages = new Set<string>();
  const apiRoutes = new Set<string>();
  const rootDirs: string[] = [];

  const add = (route: string, api: boolean) => {
    const clean = route === "" ? "/" : route.replace(/\/{2,}/g, "/").replace(/(.+)\/$/, "$1");
    (api ? apiRoutes : pages).add(clean);
  };

  const sources = sourcesFor(framework);
  // Also scan Next.js roots so projects mixing conventions still map.
  if (framework !== "nextjs") sources.push(...sourcesFor("nextjs"));

  for (const src of sources) {
    const rootAbs = join(projectPath, src.root);
    if (!existsSync(rootAbs)) continue;
    if (!rootDirs.includes(src.root)) rootDirs.push(src.root);
    walk(rootAbs, (abs) => {
      const rel = relative(rootAbs, abs).split(sep).join("/");
      src.collect(rel, add);
    });
  }

  let note: string | undefined;
  if (pages.size === 0) {
    // Couldn't statically map routes (e.g. a Vite/CRA SPA). Give the agent a
    // starting point and tell it to crawl links from "/" via list_links.
    pages.add("/");
    note =
      framework === "vite" || framework === "cra"
        ? `${framework} is a client-rendered SPA — routes are not file-based. Start at "/" and use list_links to discover navigation.`
        : `No routes were statically mapped. Start at "/" and use list_links to discover navigation.`;
  }

  return {
    framework,
    pages: [...pages].sort(),
    apiRoutes: [...apiRoutes].sort(),
    rootDirs,
    ...(note ? { note } : {}),
  };
}

const MAX_FILE_BYTES = 64 * 1024;

/** Read a file inside the project, guarding against path traversal. */
export function readProjectFile(
  projectPath: string,
  relPath: string,
): { content: string; truncated: boolean } {
  const base = resolve(projectPath);
  const target = resolve(base, relPath);
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error("Path is outside the project directory.");
  }
  for (const seg of relative(base, target).split(sep)) {
    if (IGNORE.has(seg)) throw new Error(`Reading from ${seg} is not allowed.`);
  }
  const buf = readFileSync(target);
  const truncated = buf.byteLength > MAX_FILE_BYTES;
  return {
    content: buf.subarray(0, MAX_FILE_BYTES).toString("utf8"),
    truncated,
  };
}
