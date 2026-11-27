import type { Genre, Title } from "@/lib/types";

/**
 * Maps the Xtream panel catalogue (served by the PHP backend) onto NOFLIX
 * Title objects. Panel titles have tmdbId 0 and carry their panel origin in
 * `panel`, so the player routes them through /api/stream?panel=1 instead of
 * the TMDB embed resolvers. Overviews are filled in later via /api/panel/info.
 *
 * Raw Xtream shapes (per the PHP contract):
 * - movie: { stream_id, name, stream_icon, rating/rating_5based, year,
 *   category_id, container_extension }
 * - series: { series_id, name, cover, rating/rating_5based, releaseDate
 *   or year, category_id, genre }
 * - live: { stream_id, name, stream_icon, category_id }
 */

export type PanelCategory = { id: number; name: string };

type RawItem = Record<string, unknown>;

function toNumber(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : typeof value === "number" ? value : NaN;
  return Number.isFinite(n) ? n : undefined;
}

function toString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** First 4-digit year found in a year/releaseDate value, else 0. */
function parseYear(value: unknown): number {
  const match = String(value ?? "").match(/(\d{4})/);
  return match ? Number(match[1]) : 0;
}

/**
 * Xtream rating (0–10) normalised to 0–10. rating_5based is 0–5, so it is
 * doubled; otherwise the plain rating is used. Missing/invalid → 0.
 */
function normalizeRating(item: RawItem): number {
  const five = toNumber(item.rating_5based);
  if (five !== undefined && five > 0) return Math.min(10, Math.max(0, five * 2));
  const ten = toNumber(item.rating);
  if (ten !== undefined) return Math.min(10, Math.max(0, ten));
  return 0;
}

/** Portuguese category names from the panel mapped onto NOFLIX genres. */
const CATEGORY_GENRE_MAP: Record<string, Genre> = {
  "ação": "Ação",
  "action": "Ação",
  "aventura": "Aventura",
  "adventure": "Aventura",
  "animação": "Animação",
  "animacao": "Animação",
  "animation": "Animação",
  "comédia": "Comédia",
  "comedia": "Comédia",
  "comedy": "Comédia",
  "crime": "Crime",
  "documentário": "Documentário",
  "documentario": "Documentário",
  "documentary": "Documentário",
  "drama": "Drama",
  "família": "Família",
  "familia": "Família",
  "family": "Família",
  "fantasia": "Fantasia",
  "fantasy": "Fantasia",
  "história": "História",
  "historia": "História",
  "history": "História",
  "terror": "Terror",
  "horror": "Terror",
  "música": "Música",
  "musica": "Música",
  "music": "Música",
  "mistério": "Mistério",
  "misterio": "Mistério",
  "mystery": "Mistério",
  "romance": "Romance",
  "ficção científica": "Ficção científica",
  "ficcao cientifica": "Ficção científica",
  "sci-fi": "Ficção científica",
  "suspense": "Suspense",
  "thriller": "Suspense",
  "guerra": "Guerra",
  "war": "Guerra",
  "faroeste": "Faroeste",
  "western": "Faroeste",
};

const KNOWN_GENRES = new Set<string>([
  "Ação", "Aventura", "Animação", "Comédia", "Crime", "Documentário", "Drama",
  "Família", "Fantasia", "História", "Terror", "Música", "Mistério", "Romance",
  "Ficção científica", "Suspense", "Guerra", "Faroeste",
]);

/**
 * Category name → [Genre]. Exact genre names and the PT→EN map above win;
 * anything else falls back to ["Ação"] (per contract).
 */
function genreFromCategory(name: string): Genre[] {
  const trimmed = name.trim();
  if (!trimmed) return ["Ação"];
  if (KNOWN_GENRES.has(trimmed)) return [trimmed as Genre];
  const mapped = CATEGORY_GENRE_MAP[trimmed.toLowerCase()];
  return [mapped ?? "Ação"];
}

export function panelCategories(list: unknown): PanelCategory[] {
  const raw = Array.isArray(list) ? list : [];
  const out: PanelCategory[] = [];
  for (const entry of raw as RawItem[]) {
    const id = toNumber(entry.category_id);
    const name = toString(entry.category_name).trim();
    if (id !== undefined && name) out.push({ id, name });
  }
  return out;
}

function categoryMap(categories: unknown): Map<number, string> {
  // Accept the raw Xtream list or an already-mapped [{id, name}] list.
  const list = panelCategories(categories);
  return new Map(list.map((c) => [c.id, c.name]));
}

function baseTitle(
  name: string,
  slug: string,
  kind: Title["kind"],
  year: number,
  genres: Genre[],
  format: string,
  panel: NonNullable<Title["panel"]>,
  live = false,
): Title {
  return {
    slug,
    tmdbId: 0,
    kind,
    name,
    year,
    genres,
    maturity: "16+",
    rating: 0,
    match: 90,
    tagline: "",
    overview: "",
    creator: "",
    cast: [],
    accent: "#22e6ff",
    format,
    panel,
    ...(live ? { live: true } : {}),
  };
}

export function panelMoviesToTitles(items: unknown, categories?: unknown): Title[] {
  const byId = categoryMap(categories);
  const list = Array.isArray(items) ? (items as RawItem[]) : [];
  const out: Title[] = [];
  for (const item of list) {
    const id = toNumber(item.stream_id);
    const name = toString(item.name).trim();
    if (id === undefined || !name) continue;
    const catName = byId.get(toNumber(item.category_id) ?? -1) ?? "";
    const ext = toString(item.container_extension) || undefined;
    const title = baseTitle(
      name,
      `panel-movie-${id}`,
      "movie",
      parseYear(item.year),
      genreFromCategory(catName),
      "Filme",
      { type: "movie", id, ...(ext ? { ext } : {}) },
    );
    title.rating = normalizeRating(item);
    out.push(title);
  }
  return out;
}

export function panelSeriesToTitles(items: unknown, categories?: unknown): Title[] {
  const byId = categoryMap(categories);
  const list = Array.isArray(items) ? (items as RawItem[]) : [];
  const out: Title[] = [];
  for (const item of list) {
    const id = toNumber(item.series_id);
    const name = toString(item.name).trim();
    if (id === undefined || !name) continue;
    const catName =
      byId.get(toNumber(item.category_id) ?? -1) ?? toString(item.genre) ?? "";
    const title = baseTitle(
      name,
      `panel-series-${id}`,
      "series",
      parseYear(item.releaseDate ?? item.year),
      genreFromCategory(catName),
      "Série",
      { type: "series", id },
    );
    title.rating = normalizeRating(item);
    out.push(title);
  }
  return out;
}

export function panelLiveToTitles(items: unknown, categories?: unknown): Title[] {
  const byId = categoryMap(categories);
  const list = Array.isArray(items) ? (items as RawItem[]) : [];
  const out: Title[] = [];
  for (const item of list) {
    const id = toNumber(item.stream_id);
    const name = toString(item.name).trim();
    if (id === undefined || !name) continue;
    const catName = byId.get(toNumber(item.category_id) ?? -1) ?? "";
    out.push(
      baseTitle(
        name,
        `panel-live-${id}`,
        "movie",
        0,
        genreFromCategory(catName),
        "Ao vivo",
        { type: "live", id },
        true,
      ),
    );
  }
  return out;
}
