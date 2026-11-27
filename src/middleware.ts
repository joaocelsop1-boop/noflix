import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Auth guard: protected pages require a logged-in PHP session.
 *
 * Calls the PHP backend's action=me with the request cookies on every
 * request. Not logged in → redirect to /login.
 *
 * tudo21: SEM CACHE do `me` — o cache de 60s do tudo20 deixava uma sessão
 * encerrada (outro aparelho entrou) navegar por até 60s antes de cair no
 * login, e o usuário via a trava como "não funcionando". A checagem de
 * sessão não pode ser cacheada. O `me` é barato (só banco, sem chamada ao
 * painel), então checar sempre não pesa na navegação.
 *
 * Fail-open: if the PHP backend is down or answers something unusable, the
 * request passes through and the API routes surface the error to the UI —
 * a panel outage must never lock the whole site.
 *
 * Edge runtime: plain fetch only — no node APIs and no server-only imports
 * here.
 */

const PHP_BACKEND_URL = process.env.PHP_BACKEND_URL ?? "http://php:80";

/**
 * Sessão única (tudo20): devolve também se a sessão foi encerrada por um
 * login em outro aparelho — o middleware manda para /login?session=ended
 * para o usuário ver o motivo, em vez de cair no login sem explicação.
 */
async function checkSession(request: NextRequest): Promise<{ loggedIn: boolean | null; sessionEnded: boolean }> {
  const cookie = request.headers.get("cookie") ?? "";
  if (!cookie) return { loggedIn: false, sessionEnded: false };

  let loggedIn: boolean | null = null;
  let sessionEnded = false;
  try {
    const res = await fetch(`${PHP_BACKEND_URL}/api.php?action=me`, {
      headers: { cookie },
      signal: AbortSignal.timeout(5_000),
    });
    const data = (await res.json()) as { loggedIn?: unknown; sessionEnded?: unknown };
    if (typeof data.loggedIn === "boolean") loggedIn = data.loggedIn;
    sessionEnded = data.sessionEnded === true;
  } catch {
    loggedIn = null; // PHP down → fail open
  }

  return { loggedIn, sessionEnded };
}

export async function middleware(request: NextRequest) {
  const { loggedIn, sessionEnded } = await checkSession(request);
  if (loggedIn === false) {
    // Sem basePath no next.config.ts, o Next.js NÃO prefixa /app aqui:
    // o redirect tem que levar o /app explícito, senão cai na raiz (o site).
    // (Antes, com basePath, o pathname NÃO levava o basePath e ele era
    // prefixado ao formatar — pôr "/app/login" duplicava para /app/app/login.)
    const url = request.nextUrl.clone();
    url.pathname = "/app/login";
    if (sessionEnded) url.searchParams.set("session", "ended");
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
