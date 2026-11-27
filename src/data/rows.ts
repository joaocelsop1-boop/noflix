import type { Genre, Row, Title } from "@/lib/types";
import { allTitles } from "@/lib/catalog";

/**
 * Shelves are *derived* from the catalogue, never typed by hand.
 *
 * Every row is filled to at least 20 titles (unless the catalogue itself is
 * smaller than that for the filter), which is what keeps a shelf from ending
 * after three posters on a wide screen. Rows may share titles with each other
 * — Netflix does the same — but never repeat inside a single row.
 */

const MIN_PER_SHELF = 20;
const WIDE_SHELF = 26;

const all = allTitles;

const byScore = (a: Title, b: Title) =>
  b.rating * 10 +
  b.match / 4 +
  (b.year >= 2024 ? 8 : 0) +
  (b.featured ? 6 : 0) +
  (b.badge ? 3 : 0) -
  (a.rating * 10 +
    a.match / 4 +
    (a.year >= 2024 ? 8 : 0) +
    (a.featured ? 6 : 0) +
    (a.badge ? 3 : 0));

const ranked = [...all].sort(byScore);
const fresh = [...all].sort((a, b) => b.year - a.year || byScore(a, b));
const topRated = [...all].sort((a, b) => b.rating - a.rating || byScore(a, b));
const mostWatched = [...all].sort((a, b) => b.match - a.match || byScore(a, b));

/**
 * Fill a row. `strict` keeps a shelf honest — an Anime row only ever contains
 * anime, a Drama row only drama — so it stays short rather than lying. Without
 * it the row is topped up from the highest-rated titles in the catalogue.
 */
function fill(pool: Title[], count: number, strict = false): Title[] {
  const out: Title[] = [];
  const seen = new Set<string>();
  const add = (list: Title[]) => {
    for (const title of list) {
      if (out.length >= count) return;
      if (seen.has(title.slug)) continue;
      seen.add(title.slug);
      out.push(title);
    }
  };
  add(pool);
  if (!strict) add(ranked);
  return out;
}

function shelf(
  id: string,
  title: string,
  hint: string,
  pool: Title[],
  count = MIN_PER_SHELF,
  strict = false,
): Row {
  return { id, title, hint, slugs: fill(pool, count, strict).map((t) => t.slug) };
}

const anime = all.filter((t) => Boolean(t.anime));
const series = all.filter((t) => t.kind === "series");
const films = all.filter((t) => t.kind === "movie");
const originals = all.filter((t) => t.original);
const acclaimed = all.filter((t) => t.rating >= 8);

const desiFavourites = [
  "3-idiots",
  "sacred-games",
  "money-heist",
  "narcos",
  "dark",
  "the-witcher",
  "squid-game",
  "parasite",
  "monk",
  "friends",
];

const comfortFavourites = [
  "friends",
  "sherlock",
  "better-call-saul",
  "modern-family",
  "brooklyn-nine-nine",
  "the-office",
  "hocus-pocus",
  "coraline",
  "the-nightmare-before-christmas",
  "home-alone",
].filter((slug) => all.some((t) => t.slug === slug));

const bySlugs = (slugs: string[]) =>
  slugs.map((slug) => all.find((t) => t.slug === slug)).filter((t): t is Title => Boolean(t));

export const rows: Row[] = [
  shelf("trending", "Em alta", "Todo mundo está assistindo", ranked, WIDE_SHELF),
  {
    id: "top10",
    title: "Top 10 na sua região hoje",
    hint: "Updated daily",
    slugs: [],
    ranked: true,
  },
  shelf("originals", "Originais CinePlus", "Só aqui", originals.length >= 12 ? originals : ranked, MIN_PER_SHELF),
  shelf("new", "Lançamentos", "Novos neste mês", fresh, WIDE_SHELF),
  shelf("award", "Premiados", "Aclamados pela crítica", acclaimed, MIN_PER_SHELF),
  shelf("popular", "Popular na CinePlus", "Mais assistidos agora", mostWatched, WIDE_SHELF),
  shelf("series", "Séries para maratonar", "Só mais um episódio", series, WIDE_SHELF),
  shelf("films", "Filmes de sucesso", "Tela grande, tela pequena", films, WIDE_SHELF),
  shelf("anime", "Destaque Anime", "Legendado, dublado, imperdível", anime, WIDE_SHELF, true),
  shelf(
    "desi",
    "Sucessos Desi e além",
    "Transmitindo de Mumbai a Karachi",
    [...bySlugs(desiFavourites), ...all.filter((t) => t.genres.includes("Crime") || t.genres.includes("Drama"))],
    MIN_PER_SHELF,
  ),
  shelf(
    "comfort",
    "Clássicos aconchegantes",
    "Aperte o play e se sinta melhor",
    [...bySlugs(comfortFavourites), ...all.filter((t) => t.genres.includes("Comédia") && t.year <= 2016)],
    MIN_PER_SHELF,
  ),
];

/* ------------------------------------------------------------------ *
 * Genre shelves — only genres that actually have a shelf's worth of
 * titles, so no row is ever three cards long.
 * ------------------------------------------------------------------ */

const GENRE_HINTS: Record<string, string> = {
  "Ação": "Lutas, perseguições, explosões",
  "Comédia": "Escolhas para rir alto",
  Drama: "Histórias que ficam com você",
  Suspense: "Deixe a luz acesa",
  "Ficção científica": "Mundos além do nosso",
  Crime: "Siga as evidências",
  Romance: "Se apaixone por algo novo",
  Fantasia: "Mitos, magia e monstros",
  "Animação": "Desenhado com perfeição",
  "Mistério": "Nada é o que parece",
  Terror: "Assista por entre os dedos",
  Aventura: "Vá para bem longe",
  "Família": "Para o sofá inteiro",
  "Documentário": "Histórias reais, bem contadas",
  "História": "O passado, repetido",
  Guerra: "Na linha de frente",
  Faroeste: "Poeira, armas e justiça",
  "Música": "Aumente o som",
};

const genreRows: Row[] = (Object.keys(GENRE_HINTS) as Genre[])
  .map((genre) => ({ genre, matches: all.filter((t) => t.genres.includes(genre)) }))
  .filter((entry) => entry.matches.length >= 16)
  .sort((a, b) => b.matches.length - a.matches.length)
  .slice(0, 10)
  .map(({ genre, matches }) =>
    shelf(
      `genre-${genre.toLowerCase().replace(/[^a-z]+/g, "-")}`,
      genre,
      GENRE_HINTS[genre],
      [...matches].sort(byScore),
      24,
      true,
    ),
  );

/** Rows derived from the live catalogue so the shelves never go stale. */
export const dynamicRows: Row[] = [
  shelf(
    "trending-today",
    "Em alta hoje",
    "O que todo mundo está assistindo agora",
    ranked,
    WIDE_SHELF,
  ),
  shelf("top-rated", "Mais bem avaliados", "Os títulos mais bem avaliados do catálogo", topRated, WIDE_SHELF),
  ...genreRows,
];
