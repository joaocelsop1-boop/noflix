import { NextResponse } from "next/server";
import { resolveTmdbMetaWithStatus } from "@/lib/tmdb";
import type { TmdbMeta, TmdbRef } from "@/lib/tmdb-types";

export const dynamic = "force-dynamic";

const MAX_ITEMS = 25;

/**
 * POST /api/tmdb-resolve — resolve em lote os dados de EXIBIÇÃO do TMDB
 * (capa, backdrop, sinopse, nota, gêneros, duração) para títulos do painel.
 *
 *   body: { items: [{ key, title, year, kind: "movie"|"series", details? }] }
 *   resp: { results: { [key]: TmdbMeta | null }, failed: string[] }
 *   failed = chaves que o TMDB não respondeu (429/timeout/rede): o
 *   cliente retenta em vez de cachear null (tudo35).
 *
 * PREGUIÇOSO: só resolve o que pedirem (o que está na tela). Fail open:
 * sem chave, sem match ou TMDB fora, o item volta null e a tela usa os
 * dados do painel — a rota nunca dá 500 por causa do TMDB.
 */
export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { items?: unknown } | null;
  const rawItems = Array.isArray(body?.items) ? body.items.slice(0, MAX_ITEMS) : [];
  const results: Record<string, TmdbMeta | null> = {};
  /* tudo35: chaves cuja resolução falhou no TMDB (429/timeout/rede) —
     o cliente NÃO cacheia null para elas e sim retenta; sem isso a
     falha transitória virava "sem match" permanente. */
  const failed: string[] = [];
  await Promise.all(
    rawItems.map(async (raw) => {
      const it = (raw ?? {}) as Partial<TmdbRef>;
      const key = typeof it.key === "string" ? it.key : "";
      if (!key || typeof it.title !== "string" || !it.title.trim()) {
        if (key) results[key] = null;
        return;
      }
      try {
        const { meta, failed: itemFailed } = await resolveTmdbMetaWithStatus({
          key,
          title: it.title,
          year: typeof it.year === "number" ? it.year : undefined,
          kind: it.kind === "series" ? "series" : "movie",
          details: Boolean(it.details),
          duration: typeof it.duration === "number" ? it.duration : undefined,
        });
        results[key] = meta;
        if (itemFailed) failed.push(key);
      } catch {
        results[key] = null;
        failed.push(key);
      }
    }),
  );
  return NextResponse.json({ results, failed }, { headers: { "cache-control": "no-store" } });
}
