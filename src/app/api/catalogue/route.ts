import { NextResponse } from "next/server";
import {
  CATALOGUE_TARGET,
  buildCatalogue,
  hasCatalogueKey,
  isKidsEntry,
  type CatalogueEntry,
  type CatalogueTab,
} from "@/lib/catalogue";
import { phpApi } from "@/lib/php";

export const revalidate = 21_600;

const TABS: CatalogueTab[] = ["movie", "series", "anime"];

/**
 * Mapeamento best-effort do nome da categoria do painel para os ids de
 * gênero TMDB que os chips da interface usam. Sem correspondência, o item
 * fica sem gênero (aparece em "Tudo", mas não num filtro específico).
 */
const GENRE_BY_NAME: Array<[RegExp, number]> = [
  [/a[cç][aã]o|action/i, 28],
  [/aventura|adventure/i, 12],
  [/anima[cç][aã]o|animation|desenho/i, 16],
  [/com[eé]dia|comedy/i, 35],
  [/crime/i, 80],
  [/document[aá]rio|documentary/i, 99],
  [/drama/i, 18],
  [/fam[ií]lia|family|infantil|kids|crian[cç]a/i, 10751],
  [/fantasia|fantasy/i, 14],
  [/terror|horror/i, 27],
  [/mist[eé]rio|mystery/i, 9648],
  [/romance/i, 10749],
  [/fic[cç][aã]o|ficcao|sci-?fi|ficcao cientifica/i, 878],
  [/suspense|thriller/i, 53],
  [/faroeste|western/i, 37],
  [/guerra|war/i, 10752],
  [/musical|m[uú]sica|music/i, 10402],
  [/hist[oó]ria|history/i, 36],
];

function genresFromCategory(category: string): number[] {
  const out: number[] = [];
  for (const [re, id] of GENRE_BY_NAME) {
    if (re.test(category) && !out.includes(id)) out.push(id);
  }
  return out;
}

const num = (value: unknown): number | undefined => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
};

/** Normaliza para busca: minúsculo e sem acento ("ação" casa com "acao"). */
function normText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/** Cache do catálogo do painel (10 min por aba): o catálogo é o mesmo para
 * todo mundo (um só painel no admin) e buscar 20 mil filmes + 10 mil séries
 * no Xtream a cada abertura deixava a inicial lenta. Só guarda resultado
 * não-vazio; vazio (deslogado/painel fora) nunca é cacheado. */
const PANEL_CACHE_TTL = 10 * 60 * 1000;
const panelCache = new Map<string, { at: number; entries: CatalogueEntry[] }>();

/** Exportado para a rota /api/panel/categories (aba Anime deriva as categorias dos itens). */
export async function cachedPanelCatalogue(
  tab: CatalogueTab,
  cookies: string | null,
): Promise<CatalogueEntry[]> {
  const hit = panelCache.get(tab);
  if (hit && Date.now() - hit.at < PANEL_CACHE_TTL) return hit.entries;
  const entries = await panelCatalogue(tab, cookies);
  if (entries.length > 0) {
    if (panelCache.size >= 10) panelCache.clear();
    panelCache.set(tab, { at: Date.now(), entries });
  }
  return entries;
}

const str = (value: unknown): string | undefined =>
  typeof value === "string" && value.length ? value : undefined;

/** Converte um item cru do painel (player_api.php) em CatalogueEntry. */
function mapPanelItem(
  raw: Record<string, unknown>,
  kind: "movie" | "series",
  categoryName: string,
): CatalogueEntry | null {
  // Filme/ao vivo usam stream_id; série usa series_id.
  const id = num(raw.stream_id ?? raw.series_id);
  const name = str(raw.name);
  if (!id || !name) return null;
  const rating10 = num(raw.rating);
  const rating5 = num(raw.rating_5based);
  const rating =
    rating10 !== undefined && rating10 > 0
      ? rating10
      : rating5 !== undefined && rating5 > 0
        ? Math.round(rating5 * 2 * 10) / 10
        : undefined;
  const year = num(raw.year);
  const anime = /anime/i.test(categoryName) || /anime/i.test(name);
  const kids = /infantil|kids|crian[cç]a|desenho/i.test(categoryName);
  return {
    key: `panel-${kind}-${id}`,
    tmdbId: 0,
    kind,
    name,
    year,
    rating,
    // Série: a capa vem em `cover`; filme/ao vivo em `stream_icon`.
    poster: str(raw.cover ?? raw.stream_icon),
    backdrop: str(raw.backdrop_path) ?? str(raw.stream_icon),
    overview: str(raw.plot),
    genres: genresFromCategory(categoryName),
    anime: anime || undefined,
    audience: kids ? "kids" : "general",
    panel: { type: kind, id },
    // id da categoria do painel — o filtro por categoria da aba usa ele.
    categoryId: str(raw.category_id),
  };
}

/**
 * Busca o catálogo do painel (via PHP, com o cookie da sessão do navegador).
 * Devolve as entradas já mapeadas, ou [] quando o painel não responde /
 * o usuário não está logado.
 *
 * O painel devolve só o category_id por item — o nome da categoria (que
 * alimenta o filtro de gênero) vem de get_*_categories, buscado junto.
 */
async function panelCatalogue(
  tab: CatalogueTab,
  cookies: string | null,
): Promise<CatalogueEntry[]> {
  const actions: Array<{ action: string; catAction: string; kind: "movie" | "series" }> =
    tab === "movie"
      ? [{ action: "get_vod_streams", catAction: "get_vod_categories", kind: "movie" }]
      : tab === "series"
        ? [{ action: "get_series", catAction: "get_series_categories", kind: "series" }]
        : [
            { action: "get_vod_streams", catAction: "get_vod_categories", kind: "movie" },
            { action: "get_series", catAction: "get_series_categories", kind: "series" },
          ];
  const out: CatalogueEntry[] = [];
  for (const { action, catAction, kind } of actions) {
    // Nome das categorias (id -> nome) para o filtro de gênero.
    const catName = new Map<string, string>();
    const catRes = await phpApi(catAction, { cookies, timeoutMs: 60_000 });
    if (catRes.status === 200 && Array.isArray(catRes.data)) {
      for (const c of catRes.data as Array<Record<string, unknown>>) {
        const id = String(c.category_id ?? "");
        const name = typeof c.category_name === "string" ? c.category_name : "";
        if (id && name) catName.set(id, name);
      }
    }
    const result = await phpApi(action, { cookies, timeoutMs: 60_000 });
    if (result.status !== 200) continue;
    const data = result.data;
    const list = Array.isArray(data) ? data : [];
    for (const raw of list) {
      if (!raw || typeof raw !== "object") continue;
      const rec = raw as Record<string, unknown>;
      const catId = String(rec.category_id ?? "");
      const entry = mapPanelItem(rec, kind, catName.get(catId) ?? "");
      if (!entry) continue;
      // Aba anime: só o que é anime de verdade (categoria ou nome).
      if (tab === "anime" && !entry.anime) continue;
      out.push(entry);
    }
  }
  return out;
}

/**
 * GET /api/catalogue?tab=movie|series|anime&offset=0&limit=120&genre=28&kids=1&q=termo
 *
 * A prateleira de um aba, ordenada por popularidade. `total` é o tamanho da
 * prateleira inteira, `results` é a janela pedida — a interface percorre 120
 * por vez para a rolagem continuar leve no celular.
 *
 * Fonte: com chave TMDB, o catálogo curado do TMDB (2.500 títulos). SEM a
 * chave, o catálogo do painel Xtream do usuário (filmes/séries do painel) —
 * é dele que os filmes vêm, então a prateleira nunca fica vazia por falta
 * da chave TMDB.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const tab = (searchParams.get("tab") ?? "movie") as CatalogueTab;
  if (!TABS.includes(tab)) {
    return NextResponse.json({ error: "unknown tab" }, { status: 400 });
  }

  const offset = Math.max(Number(searchParams.get("offset") ?? 0) || 0, 0);
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 120) || 120, 1), 240);
  const genre = Number(searchParams.get("genre")) || 0;
  const category = (searchParams.get("category") ?? "").trim();
  const kids = searchParams.get("kids") === "1";
  const audience = searchParams.get("audience");
  const q = normText((searchParams.get("q") ?? "").trim());

  // Sem chave TMDB: usa o catálogo do painel (o usuário está logado e o
  // painel está configurado no admin). Sem painel/logado, volta vazio.
  if (!hasCatalogueKey()) {
    const all = await cachedPanelCatalogue(tab, request.headers.get("cookie"));
    let filtered = all;
    if (q) filtered = filtered.filter((entry) => normText(entry.name).includes(q));
    if (category) filtered = filtered.filter((entry) => entry.categoryId === category);
    if (audience === "kids") filtered = filtered.filter((entry) => entry.audience === "kids" || isKidsEntry(entry));
    if (audience === "mature") filtered = filtered.filter((entry) => entry.audience === "mature");
    if (genre) filtered = filtered.filter((entry) => entry.genres.includes(genre));
    if (kids) filtered = filtered.filter(isKidsEntry);
    const results = filtered.slice(offset, offset + limit);
    return NextResponse.json(
      {
        tab,
        total: filtered.length,
        target: filtered.length,
        offset,
        count: results.length,
        audience: audience ?? "all",
        results,
        source: "panel",
      },
      { headers: { "cache-control": "no-store" } },
    );
  }

  const all = await buildCatalogue(tab);
  let filtered = all;
  if (q) filtered = filtered.filter((entry) => normText(entry.name).includes(q));
  if (audience === "kids") filtered = filtered.filter((entry) => entry.audience === "kids" || isKidsEntry(entry));
  if (audience === "mature") filtered = filtered.filter((entry) => entry.audience === "mature");
  if (genre) filtered = filtered.filter((entry) => entry.genres.includes(genre));
  if (kids) filtered = filtered.filter(isKidsEntry);

  const results = filtered.slice(offset, offset + limit);

  return NextResponse.json(
    {
      tab,
      total: filtered.length,
      target: CATALOGUE_TARGET,
      offset,
      count: results.length,
      audience: audience ?? "all",
      results,
    },
    {
      headers: {
        "cache-control": "public, s-maxage=21600, stale-while-revalidate=86400",
      },
    },
  );
}
