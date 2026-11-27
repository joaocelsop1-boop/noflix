import "server-only";

import { NextResponse } from "next/server";

/**
 * Server-only client for the PHP panel backend (Xtream).
 *
 * The PHP service is internal (default http://php:80) and is never exposed
 * to the browser: the browser only ever talks to the Next.js /api/panel/*
 * routes and to /php/* (same-origin rewrite, see next.config.ts). The PHP
 * session cookie is forwarded verbatim so actions that require login keep
 * working; credentials are never logged and the internal URL never leaves
 * the server.
 */

export const PHP_BACKEND_URL = process.env.PHP_BACKEND_URL ?? "http://php:80";

export type PhpApiResult = {
  status: number;
  data: unknown;
  setCookie: string[];
};

export type PhpApiOptions = {
  method?: "GET" | "POST";
  /** JSON body for POST. Never include raw credentials in logs. */
  body?: unknown;
  /** Extra query params appended after ?action=... */
  searchParams?: Record<string, string | number | undefined>;
  /** Raw Cookie header value received from the browser (may be null). */
  cookies?: string | null;
};

function collectSetCookie(res: Response): string[] {
  // Node's fetch exposes getSetCookie(); the edge/web fetch only has get().
  const fn = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  if (typeof fn === "function") return fn.call(res.headers);
  const single = res.headers.get("set-cookie");
  return single ? [single] : [];
}

/**
 * Call api.php?action=... on the PHP backend.
 * Transport failures (PHP down, bad response) become a 502 with a generic
 * error body — never leak internal detail to the caller.
 */
export async function phpApi(action: string, opts: PhpApiOptions = {}): Promise<PhpApiResult> {
  const url = new URL(`${PHP_BACKEND_URL}/api.php`);
  url.searchParams.set("action", action);
  for (const [key, value] of Object.entries(opts.searchParams ?? {})) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }

  const headers: Record<string, string> = {};
  if (opts.cookies) headers.cookie = opts.cookies;

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: opts.method ?? "GET",
      headers: {
        ...headers,
        ...(opts.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
      // The panel must answer promptly; a hung backend must not hang the page.
      signal: AbortSignal.timeout(15_000),
    });
  } catch {
    return { status: 502, data: { ok: false, error: "panel-unavailable" }, setCookie: [] };
  }

  const setCookie = collectSetCookie(res);
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    return { status: 502, data: { ok: false, error: "panel-unavailable" }, setCookie };
  }
  return { status: res.status, data, setCookie };
}

export type PhpUser = {
  id: number;
  name: string;
  email: string;
  plan_id: number | null;
  plan_name: string | null;
  expires_at: string | null;
  status: string;
};

export type PhpMe = {
  loggedIn: boolean;
  user: PhpUser | null;
  canWatch: boolean;
};

const LOGGED_OUT: PhpMe = { loggedIn: false, user: null, canWatch: false };

/**
 * GET action=me on the PHP backend.
 * Returns the typed session JSON, or null when the backend cannot be
 * reached / answers something unusable (callers decide fail-open vs
 * fail-closed from the null).
 */
export async function phpMe(cookies?: string | null): Promise<PhpMe | null> {
  const result = await phpApi("me", { cookies });
  if (result.status === 502 || typeof result.data !== "object" || result.data === null) {
    return null;
  }
  const data = result.data as Partial<PhpMe>;
  if (typeof data.loggedIn !== "boolean") return null;
  return {
    loggedIn: data.loggedIn,
    user: (data.user ?? null) as PhpUser | null,
    canWatch: data.canWatch === true,
  };
}

export { LOGGED_OUT };

/**
 * Turn a phpApi result into a NextResponse, forwarding any Set-Cookie
 * headers the PHP backend sent (session cookie) and normalising error
 * payloads to { ok: false, error } without internal detail.
 */
export function phpResponse(result: PhpApiResult): NextResponse {
  const data = result.data as Record<string, unknown> | unknown[];
  const body: unknown =
    typeof data === "object" && data !== null && !Array.isArray(data) && data.ok === false
      ? { ok: false, error: typeof data.error === "string" ? data.error : "panel-error" }
      : data;
  const res = NextResponse.json(body, { status: result.status });
  for (const cookie of result.setCookie) res.headers.append("set-cookie", cookie);
  return res;
}
