import "server-only";

export interface ApiRequestInput {
  method?: string;
  path: string;
  headers?: Record<string, string>;
  body?: unknown;
}

export interface ApiResponse {
  ok: boolean;
  status: number;
  statusText: string;
  latencyMs: number;
  contentType: string | null;
  bodySnippet: string;
  error?: string;
}

const ALLOWED_METHODS = new Set(["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"]);

function isLocalHost(host: string): boolean {
  const h = host.split(":")[0];
  return h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" || h === "::1";
}

/**
 * Performs an HTTP request against the target app. Restricted to the app's own
 * localhost origin so the agent cannot reach external hosts.
 */
export async function apiRequest(
  baseUrl: string,
  input: ApiRequestInput,
  signal: AbortSignal,
): Promise<ApiResponse> {
  const method = (input.method ?? "GET").toUpperCase();
  if (!ALLOWED_METHODS.has(method)) {
    return errorResponse(`Method ${method} is not allowed.`);
  }

  let target: URL;
  try {
    target = new URL(input.path, baseUrl);
  } catch {
    return errorResponse(`Invalid path: ${input.path}`);
  }
  if (!isLocalHost(target.host)) {
    return errorResponse(`Refusing to call non-local host: ${target.host}`);
  }

  const headers: Record<string, string> = { ...(input.headers ?? {}) };
  let body: string | undefined;
  if (input.body !== undefined && method !== "GET" && method !== "HEAD") {
    if (typeof input.body === "string") {
      body = input.body;
    } else {
      body = JSON.stringify(input.body);
      if (!headers["content-type"] && !headers["Content-Type"]) {
        headers["content-type"] = "application/json";
      }
    }
  }

  const started = Date.now();
  try {
    const res = await fetch(target, { method, headers, body, signal, redirect: "manual" });
    const latencyMs = Date.now() - started;
    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      latencyMs,
      contentType: res.headers.get("content-type"),
      bodySnippet: text.slice(0, 2000),
    };
  } catch (err) {
    const latencyMs = Date.now() - started;
    return {
      ...errorResponse(err instanceof Error ? err.message : String(err)),
      latencyMs,
    };
  }
}

function errorResponse(message: string): ApiResponse {
  return {
    ok: false,
    status: 0,
    statusText: "ERROR",
    latencyMs: 0,
    contentType: null,
    bodySnippet: "",
    error: message,
  };
}
