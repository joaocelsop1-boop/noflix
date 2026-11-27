import { NextResponse } from "next/server";
import { cachedPanelCatalogue } from "@/app/api/catalogue/route";
import {
  fetchPanelCategories,
  type PanelCategoryKind,
} from "@/lib/panel-categories";

export const dynamic = "force-dynamic";

/**
 * GET /api/panel/categories?kind=movie|series|anime
 *
 * As categorias QUE O PAINEL MANDA, na ordem dele, com o nome limpo
 * (sem "▶️" e sem "Filmes | " / "Series | ") e o slug para /genre/<slug>.
 * Filmes → categorias VOD; Séries → categorias de séries; Anime → só as
 * categorias que têm item na aba Anime (derivadas do catálogo anime).
 *
 * Deslogado ou painel fora → { kind, categories: [] } (os chips somem e a
 * grade continua sem filtro).
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const kind = (searchParams.get("kind") ?? "movie") as PanelCategoryKind;
  if (kind !== "movie" && kind !== "series" && kind !== "anime") {
    return NextResponse.json({ ok: false, error: "invalid-kind" }, { status: 400 });
  }
  const cookies = request.headers.get("cookie");
  const categories =
    kind === "anime"
      ? await fetchPanelCategories("anime", cookies, async () => {
          const entries = await cachedPanelCatalogue("anime", cookies);
          const ids = new Set<string>();
          for (const entry of entries) {
            if (entry.categoryId) ids.add(entry.categoryId);
          }
          return ids;
        })
      : await fetchPanelCategories(kind, cookies);
  return NextResponse.json(
    { kind, categories },
    { headers: { "cache-control": "no-store" } },
  );
}
