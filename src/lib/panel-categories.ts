import "server-only";

import { phpApi } from "@/lib/php";

export type PanelCategoryKind = "movie" | "series" | "anime";

export type PanelCategory = {
  /** id da categoria no painel (string, como vem do Xtream) */
  id: string;
  /** nome limpo para mostrar: sem emoji, sem "Filmes | " / "Series | " */
  name: string;
  /** slug para links /genre/<slug> */
  slug: string;
};

/**
 * Limpa o nome da categoria como o painel manda.
 *
 * O painel manda nomes como "▶️ Netflix", "▶️Lancamentos", "Filmes | Acao",
 * "Series | Doramas", "▶️ Guerra". A limpeza tira só o enfeite da frente
 * (emoji ▶ e o prefixo "Filmes | " / "Series | ") e os espaços — o resto
 * fica exatamente como o painel manda ("Acao", "Comedia", "Dorama").
 * Nome que fica vazio depois de limpar é descartado.
 */
export function cleanCategoryName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let name = raw.trim();
  // Tira emoji/símbolo da frente (▶, ▶️, etc.) e espaços.
  name = name.replace(/^[^A-Za-z0-9À-ÿ]+/u, "").trim();
  // Tira o prefixo "Filmes | " / "Series | " (com ou sem espaços).
  name = name.replace(/^(filmes?|series?)\s*\|\s*/i, "").trim();
  // Tira de novo um eventual emoji grudado depois do prefixo.
  name = name.replace(/^[^A-Za-z0-9À-ÿ]+/u, "").trim();
  return name.length > 0 ? name : null;
}

/** "Amazon Prime Video" → "amazon-prime-video"; "Família" → "familia". */
export function categorySlug(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toCategory(raw: Record<string, unknown>): PanelCategory | null {
  const id = String(raw.category_id ?? "");
  const name = cleanCategoryName(raw.category_name);
  if (!id || !name) return null;
  return { id, name, slug: categorySlug(name) };
}

const CATEGORIES_TTL = 30 * 60 * 1000;
const categoriesCache = new Map<string, { at: number; list: PanelCategory[] }>();
/** Mesma ideia do catálogo: sem coalescing, os pedidos paralelos da
 * inicial (filme, série, lançamentos, Top 10) buscavam as mesmas categorias
 * várias vezes ao mesmo tempo no painel. */
const categoriesInflight = new Map<string, Promise<PanelCategory[]>>();

async function fetchRawCategories(
  action: "get_vod_categories" | "get_series_categories",
  cookies: string | null,
): Promise<PanelCategory[]> {
  const key = action;
  const hit = categoriesCache.get(key);
  if (hit && Date.now() - hit.at < CATEGORIES_TTL) return hit.list;
  const pending = categoriesInflight.get(key);
  if (pending) return pending;
  const run = (async (): Promise<PanelCategory[]> => {
    const res = await phpApi(action, { cookies, timeoutMs: 60_000 });
    const list: PanelCategory[] = [];
    if (res.status === 200 && Array.isArray(res.data)) {
      const seen = new Set<string>();
      for (const c of res.data as Array<Record<string, unknown>>) {
        const cat = toCategory(c);
        if (cat && !seen.has(cat.id)) {
          seen.add(cat.id);
          list.push(cat);
        }
      }
    }
    if (list.length > 0) {
      if (categoriesCache.size >= 10) categoriesCache.clear();
      categoriesCache.set(key, { at: Date.now(), list });
    }
    return list;
  })();
  categoriesInflight.set(key, run);
  void run.then(
    () => categoriesInflight.delete(key),
    () => categoriesInflight.delete(key),
  );
  return run;
}

/**
 * Categorias do painel para a aba pedida, na ordem que o painel manda.
 *
 * - movie → get_vod_categories; series → get_series_categories.
 * - anime → só as categorias que TÊM item na aba Anime (os 6 itens de anime
 *   do painel estão espalhados por categorias como "Amazon Prime Video" e
 *   "Comedia" — nenhum nome de categoria contém "anime", então filtrar por
 *   palavra-chave devolveria zero. A lista vem dos category_ids distintos
 *   do catálogo anime, com os nomes buscados nas listas VOD + séries).
 *
 * Devolve [] quando deslogado ou o painel não responde (nunca quebra a
 * página: os chips somem e a grade continua funcionando sem filtro).
 */
export async function fetchPanelCategories(
  kind: PanelCategoryKind,
  cookies: string | null,
  animeCategoryIds?: () => Promise<Set<string>>,
): Promise<PanelCategory[]> {
  if (kind === "movie") return fetchRawCategories("get_vod_categories", cookies);
  if (kind === "series") return fetchRawCategories("get_series_categories", cookies);
  // anime
  const [vod, series] = await Promise.all([
    fetchRawCategories("get_vod_categories", cookies),
    fetchRawCategories("get_series_categories", cookies),
  ]);
  const ids = animeCategoryIds ? await animeCategoryIds() : new Set<string>();
  if (ids.size === 0) return [];
  // Ordem do painel: primeiro as VOD na ordem delas, depois as de séries.
  return [...vod, ...series].filter((cat) => ids.has(cat.id));
}
