import "server-only";
import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";

export interface AppMap {
  pages: string[];
  apiRoutes: string[];
  rootDirs: string[];
}

const ROUTE_ROOTS = ["app", "src/app", "pages", "src/pages"];
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

/** Convert an app-router file path into a route path. */
function appRouteFromFile(rel: string): string | null {
  // rel is relative to the route root, using forward slashes.
  const parts = rel.split("/");
  const file = parts.pop()!;
  if (!/^(page|route)\.(t|j)sx?$/.test(file)) return null;
  const segs = parts.filter((p) => !(p.startsWith("(") && p.endsWith(")"))); // skip route groups
  return "/" + segs.join("/");
}

/** Convert a pages-router file path into a route path. */
function pagesRouteFromFile(rel: string): string | null {
  if (!/\.(t|j)sx?$/.test(rel)) return null;
  if (rel.startsWith("_")) return null;
  let r = rel.replace(/\.(t|j)sx?$/, "");
  if (r.endsWith("/index")) r = r.slice(0, -"/index".length);
  if (r === "index") r = "";
  return "/" + r;
}

export function discoverApp(projectPath: string): AppMap {
  const pages = new Set<string>();
  const apiRoutes = new Set<string>();
  const rootDirs: string[] = [];

  for (const root of ROUTE_ROOTS) {
    const rootAbs = join(projectPath, root);
    if (!existsSync(rootAbs)) continue;
    rootDirs.push(root);
    const isApp = root.endsWith("app");

    walk(rootAbs, (abs) => {
      const rel = relative(rootAbs, abs).split(sep).join("/");
      if (isApp) {
        const route = appRouteFromFile(rel);
        if (route === null) return;
        if (/\/route\.(t|j)sx?$/.test(rel)) apiRoutes.add(route || "/");
        else pages.add(route || "/");
      } else {
        const route = pagesRouteFromFile(rel);
        if (route === null) return;
        if (route.startsWith("/api")) apiRoutes.add(route);
        else pages.add(route || "/");
      }
    });
  }

  return {
    pages: [...pages].sort(),
    apiRoutes: [...apiRoutes].sort(),
    rootDirs,
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
