"use client";

import { useRouter } from "next/navigation";
import { artUrl } from "@/lib/img";
import {apiUrl, appUrl} from "@/lib/paths";
import { useCallback, useEffect, useRef, useState } from "react";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { PlayIcon } from "@/components/icons";
import { useStore } from "@/components/store";
import { useInViewOnce, useTmdbMeta } from "@/lib/tmdb-client";
import { cn } from "@/lib/cn";

type Tab = "movie" | "series" | "anime";

type Entry = {
  key: string;
  tmdbId: number;
  kind: "movie" | "series";
  name: string;
  year?: number;
  rating?: number;
  poster?: string;
  genres: number[];
  anime?: boolean;
  /** which shelf found it: kids/family, mature (R / TV-MA), or general */
  audience?: "kids" | "family" | "mature" | "general";
  /** Item do painel Xtream (não TMDB): o player abre /play/0?panel=1&type=..&id=.. */
  panel?: { type: "movie" | "series" | "live"; id: number };
};

/** The audience filters offered on top of the tab + genre chips. */
const AUDIENCES: Array<{ id: AudienceId; label: string; hint: string }> = [
  { id: "all", label: "Tudo", hint: "a prateleira inteira" },
  { id: "kids", label: "Infantil e família", hint: "Livre, PG, animação familiar" },
  { id: "mature", label: "Adulto", hint: "Para maiores, TV-MA, crime, terror" },
];

type AudienceId = "all" | "kids" | "mature";

const TABS: Array<{ id: Tab; label: string; noun: string }> = [
  { id: "movie", label: "Filmes", noun: "filmes" },
  { id: "series", label: "Séries", noun: "séries" },
  { id: "anime", label: "Anime", noun: "animes" },
];

const PAGE = 96;

/**
 * The 1,000-title catalogue.
 *
 * One API route builds exactly 1,000 films, series and anime (popularity
 * ordered, artwork complete). The grid walks that shelf 120 tiles at a time on
 * an IntersectionObserver, so it feels instant and stays smooth on a phone no
 * matter how far you scroll.
 */
export function LiveCatalogue({
  initialTab,
  initialCategory,
  heading = "O catálogo completo",
  chrome = true,
}: {
  /** the tab this page opens on — the switcher stays available either way */
  initialTab?: Tab;
  /** categoria do painel (id) que esta página abre filtrada — ex. de /genre/netflix */
  initialCategory?: { id: string; tab?: Tab };
  heading?: string;
  chrome?: boolean;
} = {}) {
  const router = useRouter();
  const { profile } = useStore();
  const kids = Boolean(profile?.kids);

  const [tab, setTab] = useState<Tab>(initialCategory?.tab ?? initialTab ?? "movie");
  const [audience, setAudience] = useState<AudienceId>("all");
  /** filtro por categoria DO PAINEL (id) — nada de gênero TMDB aqui */
  const [categoryId, setCategoryId] = useState<string | undefined>(initialCategory?.id);
  const [categories, setCategories] = useState<Array<{ id: string; name: string }>>([]);
  const [items, setItems] = useState<Entry[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [done, setDone] = useState(false);
  /** true só quando a carga FALHOU (rede/HTTP) — diferente de prateleira vazia */
  const [loadError, setLoadError] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const busy = useRef(false);
  const run = useRef(0);

  const load = useCallback(
    async (
      target: Tab,
      category: string | undefined,
      offset: number,
      audienceId: AudienceId,
    ) => {
      if (busy.current) return;
      busy.current = true;
      const ticket = ++run.current;
      setLoading(true);
      setLoadError(false);

      try {
        const params = new URLSearchParams({
          tab: target,
          offset: String(offset),
          limit: String(PAGE),
        });
        if (category) params.set("category", category);
        if (kids) params.set("kids", "1");
        if (audienceId !== "all") params.set("audience", audienceId);

        const res = await fetch(apiUrl(`/api/catalogue?${params.toString()}`));
        if (!res.ok) {
          if (ticket === run.current) {
            setLoadError(true);
            setDone(true);
          }
          return;
        }
        const data = (await res.json()) as {
          results?: Entry[];
          total?: number;
          count?: number;
        };
        if (ticket !== run.current) return;

        const fresh = data.results ?? [];
        setTotal(data.total ?? 0);
        setItems((current) => (offset === 0 ? fresh : [...current, ...fresh]));
        setDone(fresh.length === 0 || offset + fresh.length >= (data.total ?? 0));
      } catch {
        if (ticket === run.current) {
          setLoadError(true);
          setDone(true);
        }
      } finally {
        if (ticket === run.current) {
          setLoading(false);
          busy.current = false;
        }
      }
    },
    [kids],
  );

  /* categorias do painel da aba atual — o que o painel manda, na ordem dele */
  useEffect(() => {
    let alive = true;
    void fetch(apiUrl(`/api/panel/categories?kind=${tab}`), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive) return;
        const list = Array.isArray(data?.categories) ? data.categories : [];
        setCategories(
          list.filter(
            (c: { id?: unknown; name?: unknown }) =>
              typeof c.id === "string" && typeof c.name === "string",
          ),
        );
      })
      .catch(() => {
        if (alive) setCategories([]);
      });
    return () => {
      alive = false;
    };
  }, [tab]);

  /* start over whenever the filter changes */
  useEffect(() => {
    setItems([]);
    setTotal(0);
    setDone(false);
    setLoadError(false);
    busy.current = false;
    void load(tab, categoryId, 0, audience);
  }, [tab, categoryId, audience, load]);

  /* walk the shelf as you scroll */
  useEffect(() => {
    const node = sentinel.current;
    if (!node || done) return;
    const observer = new IntersectionObserver(
      (entries) => {
        /* only walk further once the reader has actually started scrolling —
           otherwise the first paint can chain-load the whole shelf */
        if (entries[0]?.isIntersecting && !busy.current && window.scrollY > 240) {
          void load(tab, categoryId, items.length, audience);
        }
      },
      { rootMargin: "420px 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [items.length, done, tab, categoryId, audience, load]);

  const activeTab = TABS.find((entry) => entry.id === tab) ?? TABS[0];
  const activeCategory = categories.find((c) => c.id === categoryId);
  const progress = total > 0 ? Math.round((items.length / total) * 100) : 0;

  return (
    <>
      {chrome && <Navbar />}
      <main className={cn("min-h-screen pb-16", chrome && "pt-24 md:pt-28")}>
        <div className="mx-auto max-w-[1500px] px-4 md:px-12">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[var(--nf-accent)]">
                {kids ? "Prateleira segura para crianças" : "Navegar"}
              </p>
              <h1 className="mt-1 font-display text-[clamp(1.6rem,4vw,2.6rem)] leading-none text-white">
                {heading}
              </h1>
              <p className="mt-2 max-w-[60ch] text-[12.5px] text-white/50">
                {total > 0
                  ? `${total.toLocaleString()} ${activeTab.noun} prontos para assistir — ${items.length.toLocaleString()} carregados${activeCategory ? ` em “${activeCategory.name}”` : ""}. Mais títulos aparecem ao rolar.`
                  : kids
                    ? "Carregando a prateleira segura — família, animação e comédia."
                    : "Carregando a prateleira — filmes, séries e anime, por popularidade."}
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
                {TABS.map((entry) => (
                  <button
                    key={entry.id}
                    type="button"
                    onClick={() => {
                      setCategoryId(undefined);
                      setTab(entry.id);
                    }}
                    className={cn(
                      "rounded-full px-4 py-1.5 text-[13px] font-semibold transition",
                      tab === entry.id
                        ? "bg-white text-black"
                        : "bg-white/10 text-white/75 hover:bg-white/20 hover:text-white",
                    )}
                  >
                    {entry.label}
                  </button>
                ))}
            </div>
          </div>

          {/* audience chips — everything, kids/family, mature */}
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {AUDIENCES.map((option) => (
              <Chip
                key={option.id}
                active={audience === option.id}
                onClick={() => setAudience(option.id)}
              >
                {option.label}
              </Chip>
            ))}
            {kids && (
              <span className="text-[11px] text-white/40">
                Perfil infantil — títulos adultos estão ocultos
              </span>
            )}
          </div>

          {/* categorias do painel — o que o servidor manda, na ordem dele */}
          {categories.length > 0 && (
            <div className="no-scrollbar -mx-4 mt-3 flex gap-2 overflow-x-auto px-4 pb-1 md:mx-0 md:flex-wrap md:px-0">
              <Chip active={!categoryId} onClick={() => setCategoryId(undefined)}>
                Tudo
              </Chip>
              {categories.map((category) => (
                <Chip
                  key={category.id}
                  active={categoryId === category.id}
                  onClick={() => setCategoryId(category.id === categoryId ? undefined : category.id)}
                >
                  {category.name}
                </Chip>
              ))}
            </div>
          )}

          {/* progress rail — honest, tiny, never blocks the grid */}
          {total > 0 && (
            <div className="mt-4 h-[2px] w-full overflow-hidden rounded-full bg-white/10">
              <div
                className="h-full bg-[var(--nf-accent)] transition-[width] duration-500"
                style={{ width: `${Math.max(progress, 2)}%` }}
              />
            </div>
          )}

          <div className="mt-5 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 md:gap-3 lg:grid-cols-6 xl:grid-cols-7">
            {items.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={() => {
                  // Item do painel: abre o player do painel (stream do Xtream).
                  if (item.panel) {
                    router.push(
                      // tudo22: leva o ano do catálogo na URL (ver panel-home).
                      appUrl(`/play/0?panel=1&type=${item.panel.type}&id=${item.panel.id}&title=${encodeURIComponent(item.name)}${item.year ? `&year=${item.year}` : ""}`),
                    );
                    return;
                  }
                  router.push(
                    appUrl(`/play/${item.tmdbId}?title=${encodeURIComponent(item.name)}&kind=${
                      item.kind === "series" ? "series" : "movie"
                    }${item.anime ? "&anime=1" : ""}&year=${item.year ?? ""}`),
                  );
                }}
                style={{ contentVisibility: "auto", containIntrinsicSize: "260px 390px" }}
                className="group relative overflow-hidden rounded-[6px] bg-[#1b1b1b] text-left ring-1 ring-white/5 transition duration-200 hover:z-10 hover:ring-white/40 focus-brand"
              >
                <span className="relative block aspect-[2/3] w-full overflow-hidden">
                  <CataloguePoster item={item} />
                  <span className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent opacity-0 transition group-hover:opacity-100" />
                  <span className="absolute inset-0 grid place-items-center opacity-0 transition group-hover:opacity-100">
                    <span className="grid h-9 w-9 place-items-center rounded-full border-2 border-white bg-black/40 text-white">
                      <PlayIcon width={12} height={12} />
                    </span>
                  </span>
                  {item.anime && (
                    <span className="absolute left-1 top-1 rounded-sm bg-[var(--nf-accent)] px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider text-white">
                      Anime
                    </span>
                  )}
                </span>
                <span className="block px-1.5 pb-1.5 pt-1.5">
                  <span className="block truncate text-[11px] font-medium leading-tight text-white/90">
                    {item.name}
                  </span>
                  <CatalogueCardMeta item={item} />
                </span>
              </button>
            ))}

            {loading &&
              Array.from({ length: 14 }).map((_, index) => (
                <div key={`skeleton-${index}`} className="animate-pulse">
                  <div className="aspect-[2/3] w-full rounded-[6px] bg-white/[0.06]" />
                  <div className="mt-1.5 h-2.5 w-3/4 rounded bg-white/[0.06]" />
                </div>
              ))}
          </div>

          <div ref={sentinel} className="h-10" />

          {done && items.length > 0 && (
            <p className="pb-6 text-center text-[12px] text-white/35">
              É toda a prateleira — {items.length.toLocaleString()} {activeTab.noun}.
            </p>
          )}
          {done && items.length === 0 && !loading && loadError && (
            <div className="pb-8 text-center">
              <p className="text-[13px] text-white/55">
                Não foi possível carregar a prateleira agora — confira sua conexão e
                tente novamente.
              </p>
              <div className="mt-3 flex flex-wrap justify-center gap-2">
                <a
                  href={appUrl("/browse")}
                  className="rounded-full bg-white px-4 py-1.5 text-[12.5px] font-semibold text-black transition hover:bg-white/85"
                >
                  Navegar pelo catálogo
                </a>
                <button
                  type="button"
                  onClick={() => {
                    setDone(false);
                    setLoadError(false);
                    setLoading(true);
                    void load(tab, categoryId, 0, audience);
                  }}
                  className="rounded-full bg-white/10 px-4 py-1.5 text-[12.5px] font-semibold text-white/85 transition hover:bg-white/20"
                >
                  Tentar novamente
                </button>
              </div>
            </div>
          )}
          {done && items.length === 0 && !loading && !loadError && (
            <div className="pb-8 text-center">
              <p className="text-[13px] text-white/55">
                Nenhum título por aqui ainda.
              </p>
            </div>
          )}
        </div>
      </main>
      {chrome && <Footer />}
    </>
  );
}

/**
 * tudo31: nota e ano no card do catálogo — os cards mostravam SÓ o título
 * porque usavam `item.rating`/`item.year` DO PAINEL, e o painel quase
 * nunca devolve nota (e muitas vezes nem ano) na lista (get_vod_streams /
 * get_series). O detalhe já tinha os dados porque resolve o TMDB; o card
 * agora resolve também, com o mesmo useTmdbMeta do PanelPosterCard /
 * Top10Caption (mesma chave = cache compartilhado, fila em lote de 25,
 * sem chamada extra por card repetido). Nota SÓ do TMDB (o rating do
 * painel é o "8 falso"/vazio — tudo27 item 6); ano é o do painel quando
 * há, senão o do TMDB. Enquanto resolve, mostra o ano do painel se
 * houver e nenhum ★; sem match, fica só o ano do painel (nunca quebra).
 */
function CatalogueCardMeta({ item }: { item: Entry }) {
  // tudo36: gate de viewport — mesmo motivo do PanelPosterCard.
  const { ref: inViewRef, inView } = useInViewOnce<HTMLSpanElement>();
  const meta = useTmdbMeta(
    inView
      ? {
          key: item.key,
          title: item.name,
          year: item.year,
          kind: item.kind,
        }
      : null,
  );
  const rating = meta?.rating;
  const year = item.year ?? meta?.year;
  return (
    <span ref={inViewRef} className="mt-0.5 flex items-center gap-1 text-[9.5px] text-white/45">
      {rating ? (
        <span className="flex items-center gap-0.5 font-semibold text-[#ffc107]">
          ★ {rating.toFixed(1)}
        </span>
      ) : null}
      {year ? <span>· {year}</span> : null}
    </span>
  );
}

/**
 * Capa com fallback imediato: se a URL do painel estiver morta (404/403 no
 * servidor de imagens), o <img> quebra e o gradiente com o título aparece
 * na hora — a fileira não fica esperando o erro de rede.
 */
function CataloguePoster({ item }: { item: Entry }) {
  const [broken, setBroken] = useState(false);
  if (!item.poster || broken) {
    return (
      <span className="absolute inset-0 grid place-items-center bg-gradient-to-br from-[#232323] to-[#0f0f0f] p-2 text-center text-[11px] text-white/60">
        {item.name}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={artUrl(item.poster)}
      alt={item.name}
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
      className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.04]"
    />
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "shrink-0 whitespace-nowrap rounded-full border px-3 py-1 text-[12px] transition",
        active
          ? "border-white bg-white text-black"
          : "border-white/20 text-white/70 hover:border-white/50 hover:text-white",
      )}
    >
      {children}
    </button>
  );
}
