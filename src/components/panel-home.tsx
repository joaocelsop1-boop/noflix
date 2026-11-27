"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { artUrl } from "@/lib/img";
import { apiUrl } from "@/lib/paths";
import { fetchPanelMe } from "@/lib/panel";
import { cn } from "@/lib/cn";
import { Footer } from "@/components/footer";
import { Navbar } from "@/components/navbar";
import { ShelfStrip } from "@/components/shelf-strip";
import { ChevronRightIcon, PlayIcon } from "@/components/icons";
import { ContinueRow } from "@/components/row";
import { useStore } from "@/components/store";
import type { CatalogueEntry } from "@/lib/catalogue";

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
  return `/play/0?panel=1&type=${type}&id=${id}&title=${encodeURIComponent(entry.name)}`;
}

/** Cartão de pôster do painel, no mesmo visual das prateleiras do site. */
function PanelPosterCard({ entry }: { entry: CatalogueEntry }) {
  const router = useRouter();
  const img = artUrl(entry.poster);
  const initial = (entry.name.trim()[0] ?? "?").toUpperCase();
  /* capa morta no servidor de imagens: mostra o fallback na hora, sem
     esperar o erro de rede segurar a fileira */
  const [broken, setBroken] = useState(false);
  return (
    <button
      type="button"
      onClick={() => router.push(panelPlayUrl(entry))}
      className={cn(
        "group relative block shrink-0 snap-start overflow-hidden rounded-[4px] bg-[#222] text-left ring-1 ring-white/5 transition-[transform,box-shadow,ring] duration-300 will-change-transform",
        "w-[var(--nf-card-w,186px)]",
        "aspect-[2/3] hover:z-10 hover:scale-[1.05] hover:ring-white/30 hover:shadow-[0_18px_40px_-12px_rgba(0,0,0,0.9)]",
      )}
    >
      {img && !broken ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={img}
          alt={entry.name}
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
              {entry.name}
            </span>
          </span>
        </span>
      )}
      <span className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-col gap-1 bg-gradient-to-t from-black/95 via-black/55 to-transparent p-2 pt-10 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        <span className="line-clamp-2 text-[11.5px] font-semibold leading-tight text-white">
          {entry.name}
        </span>
        <span className="flex items-center gap-1 text-[9.5px] text-white/55">
          {entry.rating ? (
            <span className="font-semibold text-[#46d369]">{entry.rating.toFixed(1)}</span>
          ) : null}
          {entry.year ? <span>· {entry.year}</span> : null}
          <span>· {entry.kind === "series" ? "Série" : "Filme"}</span>
        </span>
      </span>
    </button>
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
          <div key={entry.key} className="relative flex snap-start items-end">
            <span
              aria-hidden
              className="rank-numeral pointer-events-none -mr-4 w-[64px] shrink-0 select-none text-[92px] md:-mr-6 md:w-[86px] md:text-[122px]"
            >
              {i + 1}
            </span>
            <PanelPosterCard entry={entry} />
          </div>
        ))}
      </ShelfStrip>
    </section>
  );
}

const HERO_ROTATE_MS = 8000;

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
  const candidates = useMemo(
    () => entries.filter((e) => e.backdrop || e.poster),
    [entries],
  );
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
  const slides = useMemo(() => {
    const valid = candidates.filter((e) => !dead.has(e.key));
    // Tudo morto? Mostra o primeiro candidato com o fallback gradiente.
    return valid.length > 0 ? valid.slice(0, 6) : candidates.slice(0, 1);
  }, [candidates, dead]);
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
  const [bgBroken, setBgBroken] = useState(false);
  useEffect(() => setBgBroken(false), [active?.key]);
  if (!active) return null;
  const bg = artUrl(active.backdrop ?? active.poster);

  return (
    <section className="relative h-[74svh] min-h-[440px] w-full overflow-hidden md:h-[88svh] md:min-h-[560px]">
      {bg && !bgBroken && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`bg-${active.key}`}
          src={bg}
          alt=""
          onError={() => {
            setBgBroken(true);
            // Cartaz morto no slide ativo: tira ele da lista e o próximo
            // válido assume (o índice fica, a lista encolhe).
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

      <div className="absolute inset-x-0 bottom-[13%] z-10 px-4 md:px-12">
        <div key={`copy-${active.key}`} className="max-w-[640px]">
          <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.32em] text-white/75">
            <span className="font-display text-lg leading-none text-netflix-red">N</span>
            <span>{active.kind === "series" ? "Séries" : "Filme"}</span>
          </div>
          <h1 className="font-display text-[clamp(2.4rem,6vw,5.2rem)] leading-[0.92] tracking-[0.01em] text-white drop-shadow-[0_6px_30px_rgba(0,0,0,0.7)]">
            {active.name}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-[13px] text-white/85">
            {active.rating ? (
              <span className="font-semibold text-[#46d369]">{active.rating.toFixed(1)}</span>
            ) : null}
            {active.year ? <span>{active.year}</span> : null}
            <span className="hidden rounded bg-white/15 px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-[0.16em] sm:inline">
              HD
            </span>
          </div>
          {active.overview ? (
            <p className="mt-4 line-clamp-3 max-w-[520px] text-[13.5px] leading-relaxed text-white/85 [text-shadow:0_2px_10px_rgba(0,0,0,0.8)] md:text-[15px]">
              {active.overview}
            </p>
          ) : null}
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => router.push(panelPlayUrl(active))}
              className="focus-brand flex items-center gap-2 rounded-[4px] bg-white px-6 py-3 text-[15px] font-semibold text-black transition duration-200 hover:bg-white/85 active:scale-[0.98]"
            >
              <PlayIcon width={20} height={20} />
              Assistir
            </button>
          </div>
        </div>
      </div>

      {slides.length > 1 && (
        <div className="absolute bottom-4 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1.5">
          {slides.map((s, i) => (
            <button
              key={s.key}
              type="button"
              aria-label={`Mostrar ${s.name}`}
              onClick={() => setIndex(i)}
              className="h-1 overflow-hidden rounded-full bg-white/25"
              style={{ width: i === index ? 26 : 10 }}
            >
              <span
                className="block h-full w-full origin-left bg-white"
                style={{ transform: i === index ? "scaleX(1)" : "scaleX(0)" }}
              />
            </button>
          ))}
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

        <div className="relative z-10 -mt-[9vh] pb-10">
          <PanelTop10Row title="Top 10 Filmes" href="/movies" entries={visible.topMovies} />
          <PanelTop10Row title="Top 10 Séries" href="/tv-shows" entries={visible.topSeries} />

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
            href="/movies"
            entries={visible.movies}
          />
          <PanelRow
            id="panel-series"
            title="Séries"
            hint={`${visible.series.length.toLocaleString("pt-BR")} séries do seu servidor`}
            href="/tv-shows"
            entries={visible.series}
          />
          <PanelRow
            id="panel-anime"
            title="Anime"
            hint={`${visible.anime.length.toLocaleString("pt-BR")} animes do seu servidor`}
            href="/anime"
            entries={visible.anime}
          />
        </div>
      </main>
      <Footer />
    </>
  );
}
