"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { artUrl } from "@/lib/img";
import {apiUrl, appUrl} from "@/lib/paths";
import { fetchPanelMe } from "@/lib/panel";
import { cleanTitle } from "@/lib/title-clean";
import { useTmdbMeta, useTmdbMetas } from "@/lib/tmdb-client";
import type { TmdbMeta } from "@/lib/tmdb-types";
import { cn } from "@/lib/cn";
import { Footer } from "@/components/footer";
import { Navbar } from "@/components/navbar";
import { ShelfStrip } from "@/components/shelf-strip";
import { ChevronRightIcon, PlayIcon } from "@/components/icons";
import { ContinueRow } from "@/components/row";
import { useStore } from "@/components/store";
import type { CatalogueEntry } from "@/lib/catalogue";
import { MOVIE_GENRES, SERIES_GENRES } from "@/lib/discover";

/** id TMDB -> nome do genero (pilulas do heroi). */
const GENRE_NAME = new Map<number, string>([
  ...MOVIE_GENRES.map((g) => [g.id, g.name] as const),
  ...SERIES_GENRES.map((g) => [g.id, g.name] as const),
]);

function heroGenres(entry: CatalogueEntry): string[] {
  const names: string[] = [];
  for (const id of entry.genres ?? []) {
    const name = GENRE_NAME.get(id);
    if (name && !names.includes(name)) names.push(name);
    if (names.length >= 3) break;
  }
  return names;
}

/**
 * Miniatura circular do heroi (estilo Pobreflix): o poster do destaque
 * num circulo; a ativa ganha anel branco. Clicar troca o heroi na hora.
 * Capa quebrada some em vez de mostrar um circulo vazio.
 */
function HeroThumb({
  entry,
  active,
  onSelect,
}: {
  entry: CatalogueEntry;
  active: boolean;
  onSelect: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const src = artUrl(entry.poster ?? entry.backdrop);
  if (!src || broken) return null;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-label={`Mostrar ${cleanTitle(entry.name).title}`}
      aria-current={active}
      className={cn(
        "h-11 w-11 shrink-0 overflow-hidden rounded-full transition md:h-[52px] md:w-[52px]",
        active
          ? "ring-2 ring-white ring-offset-2 ring-offset-black/60"
          : "opacity-70 ring-1 ring-white/30 hover:opacity-100 hover:ring-white/60",
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt=""
        loading="lazy"
        onError={() => setBroken(true)}
        className="h-full w-full object-cover"
      />
    </button>
  );
}

export type PanelHomeData = {
  movies: CatalogueEntry[];
  series: CatalogueEntry[];
  anime: CatalogueEntry[];
  /** Filmes da categoria "Lancamentos" do painel — prioridade do herói. */
  heroMovies: CatalogueEntry[];
  /** 10 séries em destaque (Lancamentos, Pedidos, Netflix, na ordem do painel). */
  topSeries: CatalogueEntry[];
  /** 10 filmes em destaque (Lancamentos, Pedidos, Cinema, na ordem do painel). */
  topMovies: CatalogueEntry[];
};

type CatalogueResponse = {
  results?: CatalogueEntry[];
  total?: number;
  source?: string;
};

async function fetchCatalogueTab(
  tab: "movie" | "series" | "anime",
  limit: number,
): Promise<CatalogueEntry[]> {
  try {
    const res = await fetch(apiUrl(`/api/catalogue?tab=${tab}&offset=0&limit=${limit}`), {
      cache: "no-store",
    });
    if (!res.ok) return [];
    const data = (await res.json()) as CatalogueResponse;
    return Array.isArray(data.results) ? data.results : [];
  } catch {
    return [];
  }
}

type PanelCategoriesResponse = { categories?: { id: string; slug: string }[] };

async function fetchCategoryIds(
  kind: "movie" | "series",
  slugs: string[],
): Promise<string[]> {
  try {
    const res = await fetch(apiUrl(`/api/panel/categories?kind=${kind}`), { cache: "no-store" });
    if (!res.ok) return [];
    const data = (await res.json()) as PanelCategoriesResponse;
    const list = Array.isArray(data.categories) ? data.categories : [];
    return slugs
      .map((slug) => list.find((c) => c.slug === slug)?.id)
      .filter((id): id is string => Boolean(id));
  } catch {
    return [];
  }
}

async function fetchCatalogueCategory(
  tab: "movie" | "series",
  categoryId: string,
  limit: number,
): Promise<CatalogueEntry[]> {
  try {
    const res = await fetch(
      apiUrl(`/api/catalogue?tab=${tab}&category=${encodeURIComponent(categoryId)}&offset=0&limit=${limit}`),
      { cache: "no-store" },
    );
    if (!res.ok) return [];
    const data = (await res.json()) as CatalogueResponse;
    return Array.isArray(data.results) ? data.results : [];
  } catch {
    return [];
  }
}

/** Filmes da categoria "Lancamentos" do painel (prioridade do herói). */
async function fetchLancamentosMovies(): Promise<CatalogueEntry[]> {
  const [id] = await fetchCategoryIds("movie", ["lancamentos"]);
  if (!id) return [];
  return fetchCatalogueCategory("movie", id, 24);
}

/**
 * Top 10 de uma aba: itens das categorias de maior destaque do painel, na
 * ordem dos slugs dados — sem inventar título e sem TMDB. Completa com os
 * itens do painel em ordem quando as categorias não rendem 10. A ordem é
 * a do painel, não "mais assistidas" (o painel não manda visualizações).
 * Filmes: Lancamentos, Pedidos, Cinema. Séries: Lancamentos, Pedidos, Netflix.
 */
async function fetchTop10(
  kind: "movie" | "series",
  slugs: string[],
  fallback: CatalogueEntry[],
): Promise<CatalogueEntry[]> {
  const ids = await fetchCategoryIds(kind, slugs);
  const seen = new Set<string>();
  const out: CatalogueEntry[] = [];
  const lists = await Promise.all(
    ids.map((id) => fetchCatalogueCategory(kind === "movie" ? "movie" : "series", id, 10)),
  );
  for (const list of lists) {
    for (const entry of list) {
      if (seen.has(entry.key)) continue;
      seen.add(entry.key);
      out.push(entry);
      if (out.length >= 10) return out;
    }
  }
  for (const entry of fallback) {
    if (out.length >= 10) break;
    if (seen.has(entry.key)) continue;
    seen.add(entry.key);
    out.push(entry);
  }
  return out.slice(0, 10);
}

/**
 * Busca o catálogo do painel para a Início. Devolve se o usuário está
 * logado e, quando sim, os dados — para a Início NUNCA cair para o
 * catálogo curado (TMDB) silenciosamente quando o painel falha: logado
 * sem painel mostra erro, não filme em inglês.
 */
export async function fetchPanelHomeData(): Promise<{
  loggedIn: boolean;
  data: PanelHomeData | null;
}> {
  const me = await fetchPanelMe();
  if (!me?.loggedIn) return { loggedIn: false, data: null };
  const [movies, series, anime, heroMovies] = await Promise.all([
    fetchCatalogueTab("movie", 72),
    fetchCatalogueTab("series", 72),
    fetchCatalogueTab("anime", 36),
    fetchLancamentosMovies(),
  ]);
  if (movies.length === 0 && series.length === 0) return { loggedIn: true, data: null };
  const [topMovies, topSeries] = await Promise.all([
    fetchTop10("movie", ["lancamentos", "pedidos", "cinema"], movies),
    fetchTop10("series", ["lancamentos", "pedidos", "netflix"], series),
  ]);
  return { loggedIn: true, data: { movies, series, anime, heroMovies, topSeries, topMovies } };
}

function panelPlayUrl(entry: CatalogueEntry): string {
  const type = entry.panel?.type ?? entry.kind;
  const id = entry.panel?.id ?? entry.tmdbId;
  // tudo22: leva o ano do catálogo na URL — sem ele a página de detalhe
  // começava com o ano atual (2026) e piscava ao corrigir para o do painel.
  // tudo24: leva o título LIMPO ([Lançamento] e "(AAAA)" fora) — o detalhe
  // e o TMDB recebem o nome certo de primeira.
  const cleaned = cleanTitle(entry.name);
  const year = entry.year ?? cleaned.year;
  const yearParam = year ? `&year=${year}` : "";
  return appUrl(`/play/0?panel=1&type=${type}&id=${id}&title=${encodeURIComponent(cleaned.title)}${yearParam}`);
}

/**
 * Cartão de pôster do painel, estilo Pobreflix: cantos arredondados e,
 * sempre visível embaixo do pôster, o título + estrela amarela com a nota.
 * (O painel não manda áudio por título, então não há selo DUBLADO/LEGENDADO
 * — mostrar um seria inventar dado.)
 */
function PanelPosterCard({
  entry,
  showCaption = true,
}: {
  entry: CatalogueEntry;
  showCaption?: boolean;
}) {
  const router = useRouter();
  /* tudo24: dados de exibição do TMDB (capa, nota) por cima do painel —
     o cartão mostra a arte do TMDB quando há match, senão a do painel. */
  const meta: TmdbMeta | null | undefined = useTmdbMeta({
    key: entry.key,
    title: entry.name,
    year: entry.year,
    kind: entry.kind,
  });
  const displayName = cleanTitle(entry.name).title;
  const img = artUrl(meta?.poster ?? entry.poster);
  const rating = meta?.rating ?? entry.rating;
  const year = entry.year ?? meta?.year;
  const initial = (displayName.trim()[0] ?? "?").toUpperCase();
  /* capa morta no servidor de imagens: mostra o fallback na hora, sem
     esperar o erro de rede segurar a fileira */
  const [broken, setBroken] = useState(false);
  return (
    <div className="w-[var(--nf-card-w,186px)] shrink-0 snap-start">
      <button
        type="button"
        onClick={() => router.push(panelPlayUrl(entry))}
        className={cn(
          "group relative block w-full overflow-hidden rounded-lg bg-[#222] text-left ring-1 ring-white/5 transition-[transform,box-shadow,ring] duration-300 will-change-transform",
          "aspect-[2/3] hover:z-10 hover:scale-[1.05] hover:ring-white/30 hover:shadow-[0_18px_40px_-12px_rgba(0,0,0,0.9)]",
        )}
      >
        {img && !broken ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={img}
            alt={displayName}
            loading="lazy"
            decoding="async"
            onError={() => setBroken(true)}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <span className="absolute inset-0 grid place-items-center bg-gradient-to-br from-[#2a2a2a] to-[#111] p-2 text-center">
            <span>
              <span className="block text-[44px] font-bold leading-none neon-text">{initial}</span>
              <span className="mt-2 block text-[11px] font-medium leading-tight text-white/80">
                {displayName}
              </span>
            </span>
          </span>
        )}
        {/* tudo24: o overlay do hover mostra só os metadados — o nome já
            está na legenda visível abaixo do pôster (antes aparecia duas
            vezes ao passar o mouse). */}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/95 via-black/55 to-transparent p-2 pt-10 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
          <span className="flex items-center gap-1 text-[9.5px] text-white/55">
            {rating ? (
              <span className="font-semibold text-[#ffc107]">★ {rating.toFixed(1)}</span>
            ) : null}
            {year ? <span>· {year}</span> : null}
            <span>· {entry.kind === "series" ? "Série" : "Filme"}</span>
          </span>
        </span>
      </button>
      {showCaption && (
        <div className="mt-2 min-w-0 px-0.5">
          <p className="truncate text-[12.5px] font-medium leading-tight text-white/90">
            {displayName}
          </p>
          <p className="mt-0.5 flex items-center gap-1 text-[11px] text-white/50">
            {rating ? (
              <span className="flex items-center gap-0.5 font-semibold text-white/75">
                <span className="text-[#ffc107]">★</span>
                {rating.toFixed(1)}
              </span>
            ) : null}
            {year ? <span>· {year}</span> : null}
            <span>· {entry.kind === "series" ? "Série" : "Filme"}</span>
          </p>
        </div>
      )}
    </div>
  );
}

function PanelRow({
  id,
  title,
  hint,
  href,
  entries,
}: {
  id: string;
  title: string;
  hint?: string;
  href: string;
  entries: CatalogueEntry[];
}) {
  if (entries.length === 0) return null;
  return (
    <section className="row-shell nf-rise group/row relative py-3 md:py-4">
      <div className="mb-2 flex items-baseline gap-3 px-4 md:px-12">
        <h2 className="text-[15px] font-semibold tracking-wide text-[#e5e5e5] transition-colors hover:text-white md:text-[19px]">
          {title}
        </h2>
        {hint && (
          <span className="hidden text-[11px] uppercase tracking-[0.16em] text-white/35 sm:block">
            {hint}
          </span>
        )}
        <Link
          href={href}
          className="ml-auto flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#54b9c5] opacity-0 transition-all duration-300 group-hover/row:opacity-100"
        >
          Explorar tudo
          <ChevronRightIcon width={14} height={14} />
        </Link>
      </div>
      <ShelfStrip label={title}>
        {entries.map((entry) => (
          <div key={entry.key} className="snap-start">
            <PanelPosterCard entry={entry} />
          </div>
        ))}
      </ShelfStrip>
    </section>
  );
}

/**
 * Top 10 do painel, estilo Netflix: número grande ao lado de cada capa
 * (mesmo visual .rank-numeral do Top 10 de filmes). A ordem é a do painel
 * — não é "mais assistidas", o painel não manda visualizações. Clique abre
 * o play do título (na série, com o seletor de temporada/episódio).
 */
function PanelTop10Row({
  title,
  href,
  entries,
}: {
  title: string;
  href: string;
  entries: CatalogueEntry[];
}) {
  if (entries.length === 0) return null;
  return (
    <section className="row-shell nf-rise group/row relative py-3 md:py-4">
      <div className="mb-2 flex items-baseline gap-3 px-4 md:px-12">
        <h2 className="text-[15px] font-semibold tracking-wide text-[#e5e5e5] transition-colors hover:text-white md:text-[19px]">
          {title}
        </h2>
        <span className="hidden text-[11px] uppercase tracking-[0.16em] text-white/35 sm:block">
          em destaque no seu servidor
        </span>
        <Link
          href={href}
          className="ml-auto flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#54b9c5] opacity-0 transition-all duration-300 group-hover/row:opacity-100"
        >
          Explorar tudo
          <ChevronRightIcon width={14} height={14} />
        </Link>
      </div>
      <ShelfStrip label={title}>
        {entries.map((entry, i) => (
          /* tudo24: respiro à esquerda — o "1" gigante ficava cortado na
             borda da tela. */
          <div key={entry.key} className="relative flex snap-start items-end pl-2 md:pl-3">
            <span
              aria-hidden
              className="rank-numeral pointer-events-none -mr-4 w-[64px] shrink-0 select-none text-[92px] md:-mr-6 md:w-[86px] md:text-[122px]"
            >
              {i + 1}
            </span>
            <PanelPosterCard entry={entry} showCaption={false} />
          </div>
        ))}
      </ShelfStrip>
    </section>
  );
}

const HERO_ROTATE_MS = 15000;

/** Herói rotativo com os filmes do painel (nunca TMDB).
 *
 * Prioridade: filmes da categoria "Lancamentos" do painel (as entradas já
 * vêm nessa ordem). Cartaz morto (fenix7 404, slackewn 403...) não entra
 * no carrossel: os cartazes dos candidatos são pré-carregados no cliente e
 * os que falham caem fora; se o slide ativo quebrar, ele sai da lista e o
 * próximo válido assume. O fallback gradiente+título fica para o caso de
 * todos os cartazes falharem — o herói nunca fica vazio.
 */
function PanelHero({ entries }: { entries: CatalogueEntry[] }) {
  const router = useRouter();
  /* tudo24: sem filtrar por arte do painel — um título sem capa no painel
     pode ter backdrop no TMDB. O filtro de mortos vive no `slides`. */
  const candidates = useMemo(() => entries, [entries]);
  const [dead, setDead] = useState<ReadonlySet<string>>(new Set());
  // Pré-carrega os cartazes dos 12 primeiros candidatos e tira da lista os
  // que não carregam — sem travar a inicial: o primeiro slide aparece na
  // hora e os mortos somem quando o preload responde.
  useEffect(() => {
    let alive = true;
    for (const entry of candidates.slice(0, 12)) {
      const url = artUrl(entry.backdrop ?? entry.poster);
      if (!url) continue;
      const img = new Image();
      img.onload = () => {};
      img.onerror = () => {
        if (!alive) return;
        setDead((prev) => {
          if (prev.has(entry.key)) return prev;
          const next = new Set(prev);
          next.add(entry.key);
          return next;
        });
      };
      img.src = url;
    }
    return () => {
      alive = false;
    };
  }, [candidates]);
  /* tudo24: dados de exibição do TMDB dos 12 primeiros candidatos —
     backdrop, sinopse, nota e gêneros por cima dos dados do painel. */
  const metas = useTmdbMetas(
    candidates.slice(0, 12).map((e) => ({ key: e.key, title: e.name, year: e.year, kind: e.kind })),
  );
  const slides = useMemo(() => {
    /* Cartaz do painel morto só tira o slide da lista quando o TMDB
       também não tem nada para ele (resolvido sem match). Enquanto o
       TMDB ainda está resolvendo, o slide fica — o backdrop do TMDB
       pode salvá-lo. Sem arte em lugar nenhum, o slide sai. */
    const valid = candidates.filter((e) => {
      const resolvedNull = metas.has(e.key) && metas.get(e.key) === null;
      if (!resolvedNull) return true;
      return Boolean(e.backdrop || e.poster) && !dead.has(e.key);
    });
    // Tudo morto? Mostra o primeiro candidato com o fallback gradiente.
    return valid.length > 0 ? valid.slice(0, 6) : candidates.slice(0, 1);
  }, [candidates, dead, metas]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (slides.length < 2) return;
    const t = window.setTimeout(
      () => setIndex((i) => (i + 1) % slides.length),
      HERO_ROTATE_MS,
    );
    return () => window.clearTimeout(t);
  }, [index, slides.length]);

  const active = slides[Math.min(index, slides.length - 1)] ?? slides[0];
  const activeMeta: TmdbMeta | null | undefined = active ? metas.get(active.key) : undefined;
  /* tudo24: cadeia de fallback do backdrop — TMDB primeiro, painel depois.
     Se uma URL quebrar, tenta a próxima; só tira o slide quando acabarem. */
  const bgCandidates = useMemo(() => {
    if (!active) return [] as string[];
    const urls = [
      activeMeta?.backdrop,
      activeMeta?.poster,
      active.backdrop,
      active.poster,
    ]
      .map((u) => (u ? artUrl(u) : undefined))
      .filter((u): u is string => Boolean(u));
    return Array.from(new Set(urls));
  }, [active, activeMeta]);
  const [bgIdx, setBgIdx] = useState(0);
  useEffect(() => setBgIdx(0), [active?.key]);
  const bg = bgCandidates[Math.min(bgIdx, bgCandidates.length - 1)];
  if (!active) return null;
  const displayName = cleanTitle(active.name).title;
  const displayRating = activeMeta?.rating ?? active.rating;
  const displayYear = activeMeta?.year ?? active.year;
  const displayOverview = activeMeta?.overview ?? active.overview;
  const displayGenres =
    activeMeta && activeMeta.genres.length > 0 ? activeMeta.genres : heroGenres(active);

  return (
    <section className="relative h-[80svh] min-h-[520px] w-full overflow-hidden md:h-[88svh] md:min-h-[560px]">
      {bg && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`bg-${active.key}`}
          src={bg}
          alt=""
          onError={() => {
            if (bgIdx < bgCandidates.length - 1) {
              setBgIdx((i) => i + 1);
              return;
            }
            // Acabaram as capas: tira o slide da lista e o próximo válido assume.
            setDead((prev) => {
              if (prev.has(active.key)) return prev;
              const next = new Set(prev);
              next.add(active.key);
              return next;
            });
          }}
          className="absolute inset-0 h-full w-full object-cover"
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-[#141414]/25 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#141414] via-[#141414]/55 to-transparent" />
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/80 to-transparent" />

      <div className="absolute inset-x-0 bottom-[18%] z-10 px-4 md:bottom-[21%] md:px-12">
        <div key={`copy-${active.key}`} className="max-w-[640px]">
          <div className="mb-3">
            <span className="rounded-sm bg-[#e50914] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white">
              {active.kind === "series" ? "Série" : "Filme"}
            </span>
          </div>
          <h1 className="font-display text-[clamp(1.9rem,6vw,5.2rem)] leading-[0.92] tracking-[0.01em] text-white drop-shadow-[0_6px_30px_rgba(0,0,0,0.7)]">
            {displayName}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 text-[13px] text-white/85">
            {displayRating ? (
              <span className="flex items-center gap-1 font-semibold text-white">
                <span className="text-[#ffc107]">★</span>
                {displayRating.toFixed(1)}
              </span>
            ) : null}
            {displayYear ? <span>{displayYear}</span> : null}
            {displayGenres.map((g) => (
              <span
                key={g}
                className="rounded-full border border-white/25 bg-black/30 px-2.5 py-0.5 text-[11px] font-medium text-white/85"
              >
                {g}
              </span>
            ))}
            <span className="hidden rounded bg-white/15 px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-[0.16em] sm:inline">
              HD
            </span>
          </div>
          {displayOverview ? (
            <p className="mt-4 line-clamp-2 hidden max-w-[520px] text-[13.5px] leading-relaxed text-white/85 [text-shadow:0_2px_10px_rgba(0,0,0,0.8)] sm:block md:text-[15px]">
              {displayOverview}
            </p>
          ) : null}
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => router.push(panelPlayUrl(active))}
              className="focus-brand flex items-center gap-2.5 rounded-full bg-[#e50914] px-6 py-3 text-[15px] font-bold text-white shadow-[0_8px_30px_rgba(229,9,20,0.45)] transition duration-200 hover:bg-[#f6121f] active:scale-[0.98]"
            >
              <span className="grid h-6 w-6 place-items-center rounded-full bg-white">
                <PlayIcon width={12} height={12} className="text-[#e50914]" />
              </span>
              Assistir Agora
            </button>
          </div>
        </div>
      </div>

      {slides.length > 1 && (
        /* tudo24: z-20 + espaço próprio — a fileira de baixo (que sobe com
           -mt) cobria as bolinhas e roubava o clique. Sem o -mt, elas ficam
           dentro do herói, clicáveis. */
        <div className="absolute inset-x-0 bottom-3 z-20 flex justify-center md:bottom-5">
          <div className="no-scrollbar flex max-w-full items-center gap-2 overflow-x-auto px-4 md:gap-3">
            {slides.map((s, i) => (
              <HeroThumb
                key={s.key}
                entry={{ ...s, poster: metas.get(s.key)?.poster ?? s.poster }}
                active={i === index}
                onSelect={() => setIndex(i)}
              />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * Início com o conteúdo DO PAINEL: herói + Filmes + Séries (+ Anime) vindos
 * do servidor do usuário. Nenhum título do catálogo curado (TMDB) aparece
 * aqui. Minha Lista / Continuar assistindo continuam vindo da loja local.
 */
export function PanelHome({ data }: { data: PanelHomeData }) {
  const { myList, profile } = useStore();
  const kids = Boolean(profile?.kids);

  const visible = useMemo(() => {
    const safe = (list: CatalogueEntry[]) =>
      kids ? list.filter((e) => e.audience === "kids") : list;
    return {
      movies: safe(data.movies),
      series: safe(data.series),
      anime: safe(data.anime),
      heroMovies: safe(data.heroMovies),
      topSeries: safe(data.topSeries),
      topMovies: safe(data.topMovies),
    };
  }, [data, kids]);

  // Herói: Lançamentos do painel primeiro, depois o resto dos filmes.
  const heroEntries = useMemo(() => {
    const seen = new Set<string>();
    const out: CatalogueEntry[] = [];
    for (const entry of [...visible.heroMovies, ...visible.movies]) {
      if (seen.has(entry.key)) continue;
      seen.add(entry.key);
      out.push(entry);
    }
    return out.length > 0 ? out : visible.series;
  }, [visible]);

  return (
    <>
      <Navbar />
      <main>
        <PanelHero entries={heroEntries} />

        {/* tudo24: sem o -mt-[9vh] — a fileira subia por cima do herói e
            cobria as bolinhas circulares (o clique não chegava nelas e
            elas tampavam o topo do Top 10). As fileiras começam abaixo
            do herói; as bolinhas têm espaço próprio dentro dele. */}
        <div className="relative z-10 pb-10">
          <PanelTop10Row title="Top 10 Filmes" href={appUrl("/movies")} entries={visible.topMovies} />
          <PanelTop10Row title="Top 10 Séries" href={appUrl("/tv-shows")} entries={visible.topSeries} />

          {myList.length > 0 && (
            <ContinueRow
              slugs={myList.slice(0, 12)}
              title="Minha Lista"
              hint={`${myList.length} ${myList.length === 1 ? "título salvo" : "títulos salvos"}`}
              showProgress={false}
            />
          )}

          <PanelRow
            id="panel-movies"
            title="Filmes"
            hint={`${visible.movies.length.toLocaleString("pt-BR")} filmes do seu servidor`}
            href={appUrl("/movies")}
            entries={visible.movies}
          />
          <PanelRow
            id="panel-series"
            title="Séries"
            hint={`${visible.series.length.toLocaleString("pt-BR")} séries do seu servidor`}
            href={appUrl("/tv-shows")}
            entries={visible.series}
          />
          <PanelRow
            id="panel-anime"
            title="Anime"
            hint={`${visible.anime.length.toLocaleString("pt-BR")} animes do seu servidor`}
            href={appUrl("/anime")}
            entries={visible.anime}
          />
        </div>
      </main>
      <Footer />
    </>
  );
}
