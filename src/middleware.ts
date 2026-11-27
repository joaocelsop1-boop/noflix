import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Auth guard: protected pages require a logged-in PHP session.
 *
 * Calls the PHP backend's action=me with the request cookies (60s in-memory
 * cache per cookie hash, so navigation doesn't hit the panel every time).
 * Not logged in → redirect to /login.
 *
 * Fail-open: if the PHP backend is down or answers something unusable, the
 * request passes through and the API routes surface the error to the UI —
 * a panel outage must never lock the whole site.
 *
 * Edge runtime: plain fetch + a tiny string hash only — no node APIs and no
 * server-only imports here.
 */

const PHP_BACKEND_URL = process.env.PHP_BACKEND_URL ?? "http://php:80";
const ME_CACHE_TTL = 60_000;

type MeCacheEntry = { at: number; loggedIn: boolean };
const meCache = new Map<string, MeCacheEntry>();

function hashCookie(cookie: string): string {
  let h = 5381;
  for (let i = 0; i < cookie.length; i++) {
    h = ((h << 5) + h + cookie.charCodeAt(i)) | 0;
  }
  return String(h);
}

async function isLoggedIn(request: NextRequest): Promise<boolean | null> {
  const cookie = request.headers.get("cookie") ?? "";
  if (!cookie) return false;
  const key = hashCookie(cookie);
  const hit = meCache.get(key);
  if (hit && Date.now() - hit.at < ME_CACHE_TTL) return hit.loggedIn;

  let loggedIn: boolean | null = null;
  try {
    const res = await fetch(`${PHP_BACKEND_URL}/api.php?action=me`, {
      headers: { cookie },
      signal: AbortSignal.timeout(5_000),
    });
    const data = (await res.json()) as { loggedIn?: unknown };
    if (typeof data.loggedIn === "boolean") loggedIn = data.loggedIn;
  } catch {
    loggedIn = null; // PHP down → fail open
  }

  if (loggedIn !== null) {
    if (meCache.size >= 500) meCache.clear();
    meCache.set(key, { at: Date.now(), loggedIn });
  }
  return loggedIn;
}

export async function middleware(request: NextRequest) {
  const loggedIn = await isLoggedIn(request);
  if (loggedIn === false) {
    // Sem basePath no next.config.ts, o Next.js NÃO prefixa /app aqui:
    // o redirect tem que levar o /app explícito, senão cai na raiz (o site).
    // (Antes, com basePath, o pathname NÃO levava o basePath e ele era
    // prefixado ao formatar — pôr "/app/login" duplicava para /app/app/login.)
    const url = request.nextUrl.clone();
    url.pathname = "/app/login";
    return NextResponse.redirect(url);
  }
  // loggedIn === null means the panel could not be reached: let it through.
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/browse/:path*",
    "/movies/:path*",
    "/tv-shows/:path*",
    "/anime/:path*",
    "/my-list/:path*",
    "/new-popular/:path*",
    "/play/:path*",
    "/watch/:path*",
    "/title/:path*",
    "/genre/:path*",
    "/settings/:path*",
  ],
};
