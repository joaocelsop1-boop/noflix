import { NextResponse } from "next/server";
import { apiUrl } from "@/lib/paths";

/**
 * GET /api/search?q=
 * Busca SÓ no catálogo do painel do usuário (mesma fonte da busca da
 * tela). Os provedores externos (TVMaze, IMDb, Jikan, TMDB) foram
 * removidos: usuário logado só vê o que existe no painel dele. O
 * parâmetro `live=1` é aceito mas ignorado (compatibilidade com
 * chamadas antigas).
 * Devolve os itens do painel no formato de /api/catalogue.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const q = (searchParams.get("q") ?? "").trim();

  if (!q) return NextResponse.json({ query: "", local: [], external: [], providers: [] });

  const cookie = request.headers.get("cookie") ?? "";
  const base = new URL(request.url);
  const fetchTab = async (tab: string) => {
    const url = new URL(apiUrl("/api/catalogue"), base);
    url.searchParams.set("tab", tab);
    url.searchParams.set("q", q);
    url.searchParams.set("limit", "24");
    const res = await fetch(url, { headers: { cookie }, cache: "no-store" });
    if (!res.ok) return [];
    const data = await res.json().catch(() => null);
    return Array.isArray(data?.results) ? data.results : [];
  };

  const [movies, series] = await Promise.all([fetchTab("movie"), fetchTab("series")]);

  return NextResponse.json({
    query: q,
    local: [...movies, ...series],
    external: [],
    providers: [],
  });
}
