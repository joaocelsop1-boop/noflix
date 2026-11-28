"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { artUrl } from "@/lib/img";
import {apiUrl, appUrl} from "@/lib/paths";
import { fetchPanelMe } from "@/lib/panel";
import { cleanTitle, titleKey } from "@/lib/title-clean";
import { useInViewOnce, useTmdbMeta, useTmdbMetas } from "@/lib/tmdb-client";
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
  /* tudo25: reset quando a imagem muda — a miniatura que falhou uma vez
     nunca tentava a próxima imagem. */
  useEffect(() => setBroken(false), [src]);
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
        loading="eager"
        fetchPriority="high"
        onError={() => setBroken(true)}
        className="h-full w-full object-cover"
      />
    </button>
  );
}

export type PanelHomeData = {
  movies: CatalogueEntry[];
  series: CatalogueEntry[];
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
  /* tudo25: dedup por título limpo + ano — "The K2" e "THE K2 (LEG)" são
     entradas diferentes no painel (stream_id diferente) e apareciam como
     dois itens; mesmo título limpo + mesmo ano = um só. */
  const seenTitles = new Set<string>();
  const push = (entry: CatalogueEntry): boolean => {
    if (seen.has(entry.key)) return false;
    const tk = titleKey(entry.name, entry.year);
    if (seenTitles.has(tk)) return false;
    seen.add(entry.key);
    seenTitles.add(tk);
    out.push(entry);
    return true;
  };
  const out: CatalogueEntry[] = [];
  const lists = await Promise.all(
    ids.map((id) => fetchCatalogueCategory(kind === "movie" ? "movie" : "series", id, 10)),
  );
  for (const list of lists) {
    for (const entry of list) {
      push(entry);
      if (out.length >= 10) return out;
    }
  }
  for (const entry of fallback) {
    if (out.length >= 10) break;
    push(entry);
  }
  return out.slice(0, 10);
}

/**
 * Busca o catálogo do painel para a Início. Devolve se o usuário está
 * logado e, quando sim, os dados — para a Início NUNCA cair para o
 * catálogo curado (TMDB) silenciosamente quando o painel falha: logado
 * sem painel mostra erro, não filme em inglês.
 *
 * tudo27 (item 5): em DOIS estágios — a base (filmes + séries +
 * lançamentos) primeiro, o Top 10 depois. Antes, a home esperava TUDO
 * (base + 2 Top 10, cada um com suas chamadas de categoria) antes de
 * mostrar qualquer coisa: 20–30 s de "Carregando seu catálogo…". Agora
 * o herói e as fileiras aparecem assim que a base chega, e as fileiras
 * Top 10 entram depois (a fileira some com lista vazia e aparece quando
 * os dados chegam — PanelRow/PanelTop10Row retornam null sem entradas).
 */
export async function fetchPanelHomeData(): Promise<{
  loggedIn: boolean;
  data: PanelHomeData | null;
}> {
  const base = await fetchPanelHomeBase();
  if (!base.data) return base;
  const top = await fetchPanelHomeTop10(base.data.movies, base.data.series);
  return { loggedIn: true, data: { ...base.data, ...top } };
}

/** Estágio 1 — base da home (herói + fileiras). Top 10 vem vazio. */
export async function fetchPanelHomeBase(): Promise<{
  loggedIn: boolean;
  data: PanelHomeData | null;
}> {
  const me = await fetchPanelMe();
  if (!me?.loggedIn) return { loggedIn: false, data: null };
  /* tudo26: sem buscar anime na home (a fileira saiu; a aba Anime busca
     sozinha quando aberta). Uma chamada a menos no painel = home mais rápida. */
  const [movies, series, heroMovies] = await Promise.all([
    fetchCatalogueTab("movie", 72),
    fetchCatalogueTab("series", 72),
    fetchLancamentosMovies(),
  ]);
  if (movies.length === 0 && series.length === 0) return { loggedIn: true, data: null };
  return { loggedIn: true, data: { movies, series, heroMovies, topSeries: [], topMovies: [] } };
}

/** Estágio 2 — Top 10 (filmes e séries) para completar a home. */
export async function fetchPanelHomeTop10(
  movies: CatalogueEntry[],
  series: CatalogueEntry[],
): Promise<{ topMovies: CatalogueEntry[]; topSeries: CatalogueEntry[] }> {
  const [topMovies, topSeries] = await Promise.all([
    fetchTop10("movie", ["lancamentos", "pedidos", "cinema"], movies),
    fetchTop10("series", ["lancamentos", "pedidos", "netflix"], series),
  ]);
  return { topMovies, topSeries };
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
/* tudo26: minutos restantes -> "Faltam 45 min" / "Faltam 1h05". */
function formatRemaining(seconds?: number, duration?: number): string | undefined {
  if (seconds === undefined || !duration || duration <= seconds) return undefined;
  const left = Math.max(0, Math.round((duration - seconds) / 60));
  if (left <= 0) return undefined;
  if (left >= 60) return `Faltam ${Math.floor(left / 60)}h${String(left % 60).padStart(2, "0")}`;
  return `Faltam ${left} min`;
}

export function PanelPosterCard({
  entry,
  showCaption = true,
  /* tudo26: "Continuar assistindo" — barra de progresso vermelha na base
     do pôster (estilo Netflix) + texto de onde parou. */
  progress,
  progressLabel,
  /* tudo26: URL de play custom (retomada com ?s=&e= ou &resume=1). Sem
     ela, usa a URL padrão do painel. */
  playUrl,
}: {
  entry: CatalogueEntry;
  showCaption?: boolean;
  progress?: number;
  progressLabel?: string;
  playUrl?: string;
}) {
  const router = useRouter();
  /* tudo36: só resolve o TMDB quando o card entra na tela — a home
     montava ~200 cards de uma vez e a rajada estourava o limite do TMDB
     (40 req/10s); os 429 viravam null cacheado e a prateleira "Séries"
     ficava sem ★/ano. Fora da tela, passa null (não enfileira). */
  const { ref: inViewRef, inView } = useInViewOnce<HTMLDivElement>();
  /* tudo24: dados de exibição do TMDB (capa, nota) por cima do painel —
     o cartão mostra a arte do TMDB quando há match, senão a do painel. */
  const meta: TmdbMeta | null | undefined = useTmdbMeta(
    inView
      ? {
          key: entry.key,
          title: entry.name,
          year: entry.year,
          kind: entry.kind,
        }
      : null,
  );
  const displayName = cleanTitle(entry.name).title;
  const img = artUrl(meta?.poster ?? entry.poster);
  /* tudo27 (item 6): nota SÓ do TMDB — o `entry.rating` do painel é o "8
     falso" do Xtream e oscilava 8.0 -> 7.6 quando o TMDB resolvia. Sem
     match do TMDB (ainda resolvendo ou sem match), não mostra ★. */
  const rating = meta?.rating;
  const year = entry.year ?? meta?.year;
  const initial = (displayName.trim()[0] ?? "?").toUpperCase();
  /* capa morta no servidor de imagens: mostra o fallback na hora, sem
     esperar o erro de rede segurar a fileira */
  const [broken, setBroken] = useState(false);
  /* tudo25: reset quando a imagem muda — a capa quebrada do painel
     marcava broken=true e o pôster bom do TMDB, que chegava depois,
     nunca era tentado. */
  useEffect(() => setBroken(false), [img]);
  const pct = typeof progress === "number" ? Math.min(1, Math.max(0, progress)) : undefined;
  return (
    <div ref={inViewRef} className="w-[var(--nf-card-w,186px)] shrink-0 snap-start">
      <button
        type="button"
        onClick={() => router.push(playUrl ?? panelPlayUrl(entry))}
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
        {/* tudo26: barra de progresso (Netflix) — sempre visível quando há progresso */}
        {pct !== undefined && (
          <span className="absolute inset-x-0 bottom-0 z-10 h-[3px] bg-white/30">
            <span className="block h-full bg-[#e50914]" style={{ width: `${Math.round(pct * 100)}%` }} />
          </span>
        )}
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
          {progressLabel ? (
            <p className="mt-0.5 truncate text-[11px] font-medium text-white/60">
              {progressLabel}
            </p>
          ) : null}
        </div>
      )}
    </div>
  );
}

/**
 * tudo26: legenda do Top 10 — nota e ano visíveis SOB o pôster, igual às
 * outras fileiras. Fica fora do flex do numeral (o numeral alinha com a
 * base do pôster, não com a legenda): o recuo é a posição da borda
 * esquerda do pôster (numeral 64/86px − sobreposição 16/24px + padding
 * 16/24px = 64px no celular, 86px no desktop). Usa o mesmo useTmdbMeta do
 * cartão (mesma chave = cache compartilhado, sem chamada extra).
 */
function Top10Caption({ entry }: { entry: CatalogueEntry }) {
  // tudo36: gate de viewport — mesmo motivo do PanelPosterCard.
  const { ref: inViewRef, inView } = useInViewOnce<HTMLDivElement>();
  const meta: TmdbMeta | null | undefined = useTmdbMeta(
    inView
      ? {
          key: entry.key,
          title: entry.name,
          year: entry.year,
          kind: entry.kind,
        }
      : null,
  );
  const displayName = cleanTitle(entry.name).title;
  /* tudo27 (item 6): nota SÓ do TMDB — nunca o "8 falso" do painel. */
  const rating = meta?.rating;
  const year = entry.year ?? meta?.year;
  return (
    <div ref={inViewRef} className="ml-16 mt-2 w-[var(--nf-card-w,186px)] min-w-0 px-0.5 md:ml-[86px]">
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
          /* tudo25: respiro maior à esquerda — o "1" gigante continuava
             cortado na borda; o pl-2 do tudo24 não bastou. Junto com o
             scroll-pl do ShelfStrip e as setas flutuantes, o numeral
             inteiro fica visível. */
          <div key={entry.key} className="snap-start">
            <div className="relative flex items-end pl-4 md:pl-6">
              <span
                aria-hidden
                className="rank-numeral pointer-events-none -mr-4 w-[64px] shrink-0 select-none text-[92px] md:-mr-6 md:w-[86px] md:text-[122px]"
              >
                {i + 1}
              </span>
              <PanelPosterCard entry={entry} showCaption={false} />
            </div>
            <Top10Caption entry={entry} />
          </div>
        ))}
      </ShelfStrip>
    </section>
  );
}

/**
 * tudo26: "Continuar assistindo" estilo Netflix — na home, com os títulos
 * que o cliente estava assistindo (o player salva a posição no aparelho),
 * barra de progresso vermelha embaixo do pôster e retomada exata de onde
 * parou (filme: o minuto; série: temporada/episódio + minuto). Só aparece
 * quando há algo para continuar (2%–97%). Títulos sem metadados (progresso
 * gravado antes do tudo26) não aparecem na fileira — o progresso deles
 * continua valendo para retomar quando o título é aberto.
 */
function PanelContinueRow() {
  const { progress } = useStore();
  const items = useMemo(() => {
    return Object.entries(progress)
      .filter(([, pr]) => pr.panelId && pr.name && pr.panelType !== "live" && pr.percent >= 0.02 && pr.percent < 0.97)
      .sort((a, b) => (b[1].updated ?? 0) - (a[1].updated ?? 0))
      .slice(0, 12)
      .map(([slug, pr]) => {
        const kind = pr.kind === "series" ? "series" : "movie";
        const type = pr.panelType ?? kind;
        const entry: CatalogueEntry = {
          key: slug,
          tmdbId: 0,
          kind,
          name: pr.name ?? "",
          year: pr.year,
          genres: [],
          panel: { type, id: pr.panelId ?? 0 },
        };
        const left = formatRemaining(pr.seconds, pr.duration);
        const label =
          kind === "series"
            ? `S${pr.season} E${pr.episode}${left ? ` · ${left}` : ""}`
            : (left ?? `${Math.round(pr.percent * 100)}% assistido`);
        const base = panelPlayUrl(entry);
        /* série: ?s=&e= abre o episódio certo direto; filme: &resume=1
           pula o detalhe e retoma no minuto. O player lê o progresso pelo
           slug e volta na posição salva. */
        const url =
          kind === "series" ? `${base}&s=${pr.season}&e=${pr.episode}` : `${base}&resume=1`;
        return { entry, pr, label, url };
      });
  }, [progress]);
  if (items.length === 0) return null;
  return (
    <section className="row-shell nf-rise group/row relative py-3 md:py-4">
      <div className="mb-2 flex items-baseline gap-3 px-4 md:px-12">
        <h2 className="text-[15px] font-semibold tracking-wide text-[#e5e5e5] transition-colors hover:text-white md:text-[19px]">
          Continuar assistindo
        </h2>
        <span className="hidden text-[11px] uppercase tracking-[0.16em] text-white/35 sm:block">
          Continue de onde parou
        </span>
      </div>
      <ShelfStrip label="Continuar assistindo">
        {items.map(({ entry, pr, label, url }) => (
          <div key={entry.key} className="snap-start">
            <PanelPosterCard
              entry={entry}
              progress={pr.percent}
              progressLabel={label}
              playUrl={url}
            />
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

  /* tudo26: sinopse do herói com "Ler mais/Ler menos" (antes era cortada
     no meio da frase com "…" e não tinha como expandir). */
  const [heroOverviewExpanded, setHeroOverviewExpanded] = useState(false);
  useEffect(() => setHeroOverviewExpanded(false), [index, slides.length]);
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
  /* tudo27 (item 6): nota SÓ do TMDB — o `active.rating` do painel (8)
     aparecia antes do TMDB carregar e depois trocava para 7.6: era a
     oscilação ★8.0/★7.6 do herói. Enquanto o TMDB resolve, não mostra ★. */
  const displayRating = activeMeta?.rating;
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
          fetchPriority="high"
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
            <div className="mt-4 max-w-[520px]">
              <p
                className={cn(
                  "text-[13.5px] leading-relaxed text-white/85 [text-shadow:0_2px_10px_rgba(0,0,0,0.8)] md:text-[15px]",
                  !heroOverviewExpanded && "line-clamp-2",
                )}
              >
                {displayOverview}
              </p>
              {displayOverview.length > 180 && (
                <button
                  type="button"
                  onClick={() => setHeroOverviewExpanded((v) => !v)}
                  className="mt-1 text-[13px] font-semibold text-white/90 underline-offset-2 hover:underline"
                >
                  {heroOverviewExpanded ? "Ler menos" : "Ler mais"}
                </button>
              )}
            </div>
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
 * Início com o conteúdo DO PAINEL: herói + Filmes + Séries vindos do
 * servidor do usuário (tudo26: a fileira de Anime saiu da home — os animes
 * continuam na aba Anime e na busca). Nenhum título do catálogo curado
 * (TMDB) aparece aqui. Minha Lista / Continuar assistindo continuam vindo
 * da loja local.
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
      heroMovies: safe(data.heroMovies),
      topSeries: safe(data.topSeries),
      topMovies: safe(data.topMovies),
    };
  }, [data, kids]);

  // tudo26: fileira de CAPAS DE FILMES lá embaixo, no lugar da Anime:
  // "Lançamentos" = categoria Lançamentos do próprio painel (a mesma do
  // herói, até 24 capas). Se o painel não tiver essa categoria, cai para
  // os primeiros filmes do painel ("Mais filmes") — nunca fica vazio.
  const lancamentosRow = useMemo(() => {
    if (visible.heroMovies.length > 0)
      return { title: "Lançamentos", entries: visible.heroMovies };
    return { title: "Mais filmes", entries: visible.movies.slice(0, 20) };
  }, [visible]);

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
          {/* tudo26: "Continuar assistindo" LOGO ABAIXO DO HERÓI, no topo
              da home (igual à Netflix) — o cliente vê de cara quando entra.
              Só aparece quando há algo para continuar. */}
          <PanelContinueRow />
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
          {/* tudo26: fileira de Anime REMOVIDA da home (títulos feios,
              "ANIME SE BEBE", "Skye Hoshi" 3x...). Os animes continuam na
              aba Anime e na busca — só não aparecem mais na home. No lugar
              dela, lá embaixo, uma fileira de CAPAS DE FILMES ("Lançamentos",
              categoria do próprio painel) — o espaço não fica vazio. */}
          <PanelRow
            id="panel-lancamentos"
            title={lancamentosRow.title}
            hint="Filmes novos do seu servidor"
            href={appUrl("/movies")}
            entries={lancamentosRow.entries}
          />
        </div>
      </main>
      <Footer />
    </>
  );
}
