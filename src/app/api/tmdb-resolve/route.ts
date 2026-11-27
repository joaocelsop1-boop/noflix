import { NextResponse } from "next/server";
import { resolveTmdbMeta } from "@/lib/tmdb";
import type { TmdbMeta, TmdbRef } from "@/lib/tmdb-types";

export const dynamic = "force-dynamic";

const MAX_ITEMS = 25;

/**
 * POST /api/tmdb-resolve — resolve em lote os dados de EXIBIÇÃO do TMDB
 * (capa, backdrop, sinopse, nota, gêneros, duração) para títulos do painel.
 *
 *   body: { items: [{ key, title, year, kind: "movie"|"series", details? }] }
 *   resp: { results: { [key]: TmdbMeta | null } }
 *
 * PREGUIÇOSO: só resolve o que pedirem (o que está na tela). Fail open:
 * sem chave, sem match ou TMDB fora, o item volta null e a tela usa os
 * dados do painel — a rota nunca dá 500 por causa do TMDB.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { items?: unknown } | null;
  const rawItems = Array.isArray(body?.items) ? body.items.slice(0, MAX_ITEMS) : [];
  const results: Record<string, TmdbMeta | null> = {};
  await Promise.all(
    rawItems.map(async (raw) => {
      const it = (raw ?? {}) as Partial<TmdbRef>;
      const key = typeof it.key === "string" ? it.key : "";
      if (!key || typeof it.title !== "string" || !it.title.trim()) {
        if (key) results[key] = null;
        return;
      }
      try {
        results[key] = await resolveTmdbMeta({
          key,
          title: it.title,
          year: typeof it.year === "number" ? it.year : undefined,
          kind: it.kind === "series" ? "series" : "movie",
          details: Boolean(it.details),
        });
      } catch {
        results[key] = null;
      }
    }),
  );
  return NextResponse.json({ results }, { headers: { "cache-control": "no-store" } });
}
