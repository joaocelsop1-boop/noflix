import { NextResponse } from "next/server";
import {
  cachedPanelCatalogue,
  matchesSearch,
  normText,
} from "@/app/api/catalogue/route";

/**
 * GET /api/search?q=
 * Busca SÓ no catálogo do painel do usuário (mesma fonte da busca da
 * tela). Os provedores externos (TVMaze, IMDb, Jikan, TMDB) foram
 * removidos: usuário logado só vê o que existe no painel dele. O
 * parâmetro `live=1` é aceito mas ignorado (compatibilidade com
 * chamadas antigas).
 * Devolve os itens do painel no formato de /api/catalogue.
 *
 * tudo28 (item 1) — CAUSA do zero: esta rota buscava o catálogo por
 * HTTP interno (`new URL(apiUrl("/api/catalogue"), base)`). O `apiUrl`
 * prefixa "/app", mas DENTRO do container o Traefik já tirou o prefixo
 * — `request.url` é `http://localhost:3000/api/search?...` (SEM /app).
 * O fetch interno ia para `/app/api/catalogue`, que NÃO existe no
 * Next.js (a rota é `/api/catalogue`) → 404 → `fetchTab` devolvia []
 * para tudo. A página abria (o fetch do navegador para /api/search
 * funciona — o Traefik tira o /app na borda), mas a busca sempre vinha
 * vazia. O overlay nunca sofreu isso porque ele chama /api/catalogue
 * direto do navegador. Fix: sem HTTP — chama `cachedPanelCatalogue`
 * direto (mesma função que a home usa, com o mesmo cache de 30 min) e
 * filtra com o mesmo `matchesSearch` da prateleira.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();

  if (!q) return NextResponse.json({ query: "", local: [], external: [], providers: [] });

  const cookie = request.headers.get("cookie");
  const needle = normText(q);
  const take = async (tab: "movie" | "series") => {
    const entries = await cachedPanelCatalogue(tab, cookie);
    return entries.filter((entry) => matchesSearch(entry.name, needle)).slice(0, 24);
  };

  const [movies, series] = await Promise.all([take("movie"), take("series")]);

  return NextResponse.json({
    query: q,
    local: [...movies, ...series],
    external: [],
    providers: [],
  });
}
