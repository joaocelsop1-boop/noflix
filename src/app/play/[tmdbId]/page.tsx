import { cookies } from "next/headers";
import { Player } from "@/components/player";
import { phpApi } from "@/lib/php";
import { resolveTmdbMeta, tmdbGenreId } from "@/lib/tmdb";
import { cleanTitle } from "@/lib/title-clean";
import { seasonsFor } from "@/lib/catalog";
import { animeInfo, animeSeasons, movieInfo, realSeasons, seriesInfo } from "@/lib/seasons";
import type { Genre, Title } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Play anything the live catalogue finds.
 *  /play/155?title=The Dark Knight&kind=movie
 *  /play/16498?title=Attack on Titan&kind=series&anime=1   (AniList id)
 *
 * The page now asks TMDB for the real show (or film) instead of inventing a
 * placeholder: proper synopsis, rating, genres, runtime, artwork — and for a
 * series, **every season with its real episodes**.
 */
export default async function PlayPage({
  params,
  searchParams,
}: {
  params: Promise<{ tmdbId: string }>;
  searchParams: Promise<{
    title?: string;
    kind?: string;
    year?: string;
    anime?: string;
    poster?: string;
    backdrop?: string;
    /** explicit AniList id (anime servers) */
    anilist?: string;
    /** explicit TMDB id when the path carries an AniList id */
    tmdb?: string;
    /** MyAnimeList id (search results) — resolved to AniList in the player */
    mal?: string;
    /** season / episode to open on (deep links, "next episode") */
    s?: string;
    e?: string;
    /** tudo26: "Continuar assistindo" — retoma o filme direto, sem o detalhe */
    resume?: string;
    /** título do painel (outro agente): /play/0?panel=1&type=live&id=..&title=.. */
    panel?: string;
    type?: string;
    id?: string;
    ext?: string;
  }>;
}) {
  const { tmdbId } = await params;
  const query = await searchParams;

  /* Título do painel (tmdbId 0): vem do /live ou do catálogo do painel e
     toca no player próprio — nunca usa embed. tudo25: o nome exibido é
     SEMPRE o título limpo do painel (o que o usuário clicou); o TMDB é
     resolvido no servidor e só fornece imagem, sinopse, nota, gêneros e
     duração DO MESMO título — antes o detalhe nem chamava o TMDB e
     carregava ZERO imagens, com nota falsa 8 e sinopse inventada. */
  if (query.panel === "1") {
    const panelType =
      query.type === "series" ? "series" : query.type === "live" ? "live" : "movie";
    const panelId = Number(query.id) || 0;
    const rawTitle = query.title?.slice(0, 120) ?? `Canal ${panelId}`;
    const cleaned = cleanTitle(rawTitle);
    const displayName = cleaned.title || rawTitle;
    /* tudo26: o painel é a verdade sobre o ARQUIVO — o get_vod_info traz
       o ano de lançamento e a duração reais do arquivo. O ano do catálogo
       pode estar errado ("A Noiva!" com ano 2005 no catálogo mas o arquivo
       é o filme de 2025, 126 min): resolver o TMDB com o ano errado casa
       o filme errado ("A Noiva Cadáver", 77 min). Com o ano e a duração
       certos, o resolve casa o filme certo — e a duração ainda serve de
       checagem (o resolve rejeita match com duração muito diferente).
       Fail open: painel fora ou lento (6s) → usa o ano da URL, sem duração. */
    let panelYear: number | undefined;
    let panelDuration: number | undefined;
    let similarCategory: string | undefined;
    if (panelType === "movie") {
      try {
        const cookieHeader = (await cookies()).toString();
        const info = await phpApi("get_vod_info", {
          cookies: cookieHeader,
          searchParams: { vod_id: String(panelId) },
          timeoutMs: 6000,
        });
        const data = (info.data ?? {}) as Record<string, unknown>;
        const metaInfo = (data.info ?? {}) as Record<string, unknown>;
        const movieData = (data.movie_data ?? {}) as Record<string, unknown>;
        const relYear = Number(String(metaInfo.releaseDate ?? "").slice(0, 4)) || undefined;
        if (relYear && relYear >= 1900 && relYear <= 2100) panelYear = relYear;
        const rawDur = metaInfo.duration_secs ?? metaInfo.duration;
        if (typeof rawDur === "number" && rawDur > 0) {
          panelDuration = rawDur > 600 ? Math.round(rawDur / 60) : Math.round(rawDur);
        } else if (typeof rawDur === "string" && rawDur.includes(":")) {
          const parts = rawDur.split(":").map(Number);
          if (parts.length === 3 && parts.every(Number.isFinite)) {
            panelDuration = parts[0] * 60 + parts[1];
          }
        }
        const catId = String(movieData.category_id ?? "").trim();
        if (catId) similarCategory = catId;
      } catch {
        /* painel fora — segue com o ano da URL */
      }
    }
    const year = panelYear ?? cleaned.year ?? (Number(query.year) || 0);
    const meta =
      panelType === "live"
        ? null
        : await resolveTmdbMeta({ key: `panel-${panelType}-${panelId}`, title: displayName, year, kind: panelType as "movie" | "series", details: true, duration: panelDuration });
    const panelTitle: Title = {
      slug: `panel-${panelType}-${panelId}`,
      tmdbId: meta?.tmdbId ?? 0,
      panel: { type: panelType, id: panelId, ext: query.ext },
      live: panelType === "live",
      kind: panelType === "movie" ? "movie" : "series",
      name: displayName,
      // tudo22: ano desconhecido é 0 (não mostra ano) — antes caía para o
      // ano atual (2026) e a série piscava 2026 antes de corrigir para 1992.
      year: year || meta?.year || 0,
      genres: (meta?.genres ?? []) as Genre[],
      maturity: "16+",
      /* tudo25: nota do TMDB quando há; 0 = sem nota (o Player só mostra
         ★ quando a nota é > 0) — nunca mais o 8 inventado. */
      rating: meta?.rating ?? 0,
      match: meta?.rating ? Math.round(meta.rating * 10) : 0,
      tagline: "Transmitindo agora.",
      overview: meta?.overview ?? "",
      creator: "CinePlus",
      cast: [],
      accent: "#e50914",
      format: panelType === "live" ? "Ao vivo" : panelType === "series" ? "Séries" : "Filme",
      runtime: meta?.runtime,
    };
    const similarGenre =
      meta?.genres?.[0] ? tmdbGenreId(meta.genres[0]) : undefined;
    return (
      <Player
        /* tudo27 (item 1): `key` por título — sem ela, ir de um filme para
           outro pelo "Mais como este" REUTILIZAVA o Player e o estado velho
           (movieMeta/panelMeta/similar/temporada) continuava na tela sob o
           título novo (Bressan sob "Il corpo"). Com a key, o React desmonta
           o Player e monta um novo do zero para cada título. */
        key={panelTitle.slug}
        title={panelTitle}
        initialSeason={Math.max(Number(query.s) || 1, 1)}
        initialEpisode={Math.max(Number(query.e) || 1, 1)}
        seasons={[]}
        episodePicked={Boolean(query.s || query.e || query.resume === "1")}
        artwork={{
          poster: meta?.poster,
          backdrop: meta?.backdrop,
        }}
        similarCategory={similarCategory}
        similarGenre={similarGenre}
        cast={meta?.cast}
      />
    );
  }

  const id = Number(tmdbId);
  const isAnime = query.anime === "1";
  /* Anime can arrive as an AniList id in the path (live anime rows) or as a
     TMDB id plus ?anilist=… (live mixed rows). Normalise both to a pair. */
  const explicitAni = Number(query.anilist) || undefined;
  const explicitMal = Number(query.mal) || undefined;
  const explicitTmdb = Number(query.tmdb) || undefined;
  /* the path is only an AniList id when no TMDB/MAL id was supplied alongside */
  const pathIsAniid = isAnime && !explicitTmdb && !explicitMal;
  const anilistResolved = explicitAni ?? (pathIsAniid ? id : undefined);
  const tmdbResolved = explicitTmdb ?? (pathIsAniid || explicitMal ? 0 : id);
  const kind: "movie" | "series" = isAnime || query.kind === "series" ? "series" : "movie";

  const [show, film, anime] = await Promise.all([
    kind === "series" && tmdbResolved ? seriesInfo(tmdbResolved) : Promise.resolve(null),
    kind === "movie" && tmdbResolved ? movieInfo(tmdbResolved) : Promise.resolve(null),
    isAnime ? animeInfo({ anilistId: anilistResolved, malId: explicitMal }) : Promise.resolve(null),
  ]);

  const genres = (show?.genres ?? film?.genres ?? anime?.genres ?? []).filter(Boolean) as Genre[];
  const name =
    show?.name ?? film?.name ?? anime?.name ?? query.title?.slice(0, 120) ?? `Title ${id}`;
  const year =
    show?.year ?? film?.year ?? anime?.year ?? (Number(query.year) || 0);

  const title: Title = {
    slug: `external-${id}`,
    tmdbId: tmdbResolved,
    anilistId: anime?.anilistId ?? anilistResolved,
    malId: anime?.malId ?? explicitMal,
    anime: isAnime,
    kind,
    name,
    year,
    genres,
    maturity: film?.maturity ?? show?.maturity ?? (kind === "series" ? "TV-14" : "16+"),
    seasons: show?.seasons ?? anime?.episodes ?? (kind === "series" ? 1 : undefined),
    runtime:
      film?.runtime ??
      show?.runtime ??
      anime?.runtime ??
      (kind === "movie" ? 118 : undefined),
    rating: show?.rating ?? film?.rating ?? anime?.rating ?? 8,
    match: Math.round((show?.rating ?? film?.rating ?? anime?.rating ?? 8) * 10),
    tagline: show?.tagline ?? film?.tagline ?? "Transmitindo agora.",
    overview:
      show?.overview ??
      film?.overview ??
      anime?.overview ??
      `${name} — playing from the live catalogue.`,
    creator: "CinePlus live",
    cast: [],
    accent: "#141414",
    format: kind === "series" ? (show?.seasons === 1 ? "Série limitada" : "Séries") : "Filme",
  };

  /* real episodes when TMDB/AniList knows the show, generated ones only as a
     last resort — this is what used to collapse every series to one season */
  const seasons = isAnime
    ? await animeSeasons({ anilistId: title.anilistId, malId: title.malId })
    : kind === "series" && tmdbResolved
      ? await realSeasons(tmdbResolved)
      : [];
  const usable = seasons.length ? seasons : kind === "series" ? seasonsFor(title) : [];

  const wantedSeason = Math.max(Number(query.s) || 1, 1);
  const initialSeason = usable.some((entry) => entry.number === wantedSeason)
    ? wantedSeason
    : usable[0]?.number ?? 1;
  const episodeCount =
    usable.find((entry) => entry.number === initialSeason)?.episodes.length ?? 1;
  const initialEpisode = Math.min(Math.max(Number(query.e) || 1, 1), episodeCount);

  return (
    <Player
      /* tudo27 (item 1): mesma key por título — vale para os títulos TMDB
         também (navegar de um para outro sem dados trocados). */
      key={title.slug}
      title={title}
      initialSeason={initialSeason}
      initialEpisode={initialEpisode}
      seasons={usable}
      episodePicked={Boolean(query.s || query.e)}
      artwork={{
        poster: film?.poster ?? show?.poster ?? anime?.poster ?? query.poster,
        backdrop: film?.backdrop ?? show?.backdrop ?? anime?.backdrop ?? query.backdrop,
      }}
    />
  );
}
