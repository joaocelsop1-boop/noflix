"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { artUrl } from "@/lib/img";
import {apiUrl, appUrl} from "@/lib/paths";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { CloseIcon, SearchIcon } from "@/components/icons";
import { useStore } from "@/components/store";
import { fetchPanelMe } from "@/lib/panel";
import { useInViewOnce, useTmdbMeta } from "@/lib/tmdb-client";
import type { CatalogueEntry } from "@/lib/catalogue";

const genreColors = [
  "#e50914",
  "#1f6feb",
  "#7a1fa2",
  "#0f9d58",
  "#f4a300",
  "#d81b60",
  "#00838f",
  "#5d4037",
  "#3949ab",
  "#c62828",
  "#2e7d32",
  "#6d4c41",
];

type CatalogueResponse = {
  results?: CatalogueEntry[];
  total?: number;
  source?: string;
};

async function searchPanel(
  term: string,
  limit: number,
): Promise<CatalogueEntry[]> {
  const q = encodeURIComponent(term);
  try {
    const [movies, series] = await Promise.all([
      fetch(apiUrl(`/api/catalogue?tab=movie&q=${q}&limit=${limit}`), { cache: "no-store" }).then(
        (r) => (r.ok ? r.json() : null) as Promise<CatalogueResponse | null>,
      ),
      fetch(apiUrl(`/api/catalogue?tab=series&q=${q}&limit=${limit}`), { cache: "no-store" }).then(
        (r) => (r.ok ? r.json() : null) as Promise<CatalogueResponse | null>,
      ),
    ]);
    const out: CatalogueEntry[] = [];
    for (const res of [movies, series]) {
      if (res && Array.isArray(res.results)) out.push(...res.results);
    }
    return out;
  } catch {
    return [];
  }
}

function panelPlayUrl(entry: CatalogueEntry): string {
  const type = entry.panel?.type ?? entry.kind;
  const id = entry.panel?.id ?? entry.tmdbId;
  // tudo22: leva o ano do catálogo na URL (ver panel-home).
  const yearParam = entry.year ? `&year=${entry.year}` : "";
  return appUrl(`/play/0?panel=1&type=${type}&id=${id}&title=${encodeURIComponent(entry.name)}${yearParam}`);
}

/**
 * tudo33 (a): nota e ano no resultado da busca (overlay). O overlay
 * renderizava o nome + ano do painel + tipo ("2023 · Série") e NUNCA
 * chamava o TMDB — por isso NENHUM resultado de busca exibia ★, nem
 * filme nem série (ex.: "Silo" aparecia "2023 · Série", sem nota, mesmo
 * com o TMDB resolvendo 8.2). Mesmo useTmdbMeta dos cards (mesma chave =
 * cache compartilhado, fila em lote). Nota SÓ do TMDB; ano do painel
 * quando há, senão do TMDB.
 */
function SearchOverlayMeta({
  entry,
  suffix,
}: {
  entry: CatalogueEntry;
  suffix?: string;
}) {
  // tudo36: gate de viewport — mesmo motivo do PanelPosterCard (o
  // resultado só resolve o TMDB quando entra na tela).
  const { ref: inViewRef, inView } = useInViewOnce<HTMLSpanElement>();
  const meta = useTmdbMeta(
    inView
      ? {
          key: entry.key,
          title: entry.name,
          year: entry.year,
          kind: entry.kind,
        }
      : null,
  );
  const rating = meta?.rating;
  const year = entry.year ?? meta?.year;
  return (
    <span ref={inViewRef}>
      {rating ? (
        <span className="font-semibold text-[#ffc107]">★ {rating.toFixed(1)} · </span>
      ) : null}
      {year ? `${year} · ` : ""}
      {entry.kind === "series" ? "Série" : "Filme"}
      {suffix ?? ""}
    </span>
  );
}

/**
 * Busca SÓ no catálogo do painel (filmes e séries do servidor do usuário).
 * Nada de TMDB, nada de provedor externo: o que aparece aqui é o que toca.
 */
export function SearchOverlay() {
  const router = useRouter();
  const { searchOpen, setSearchOpen } = useStore();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<CatalogueEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [top, setTop] = useState<CatalogueEntry[]>([]);
  /** categorias do painel para o grid "Explore" — nada de gênero TMDB */
  const [panelCategories, setPanelCategories] = useState<
    Array<{ id: string; name: string; slug: string }>
  >([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!searchOpen) {
      setQuery("");
      setResults([]);
      setSearched(false);
      return;
    }
    const t = window.setTimeout(() => inputRef.current?.focus(), 80);
    void fetchPanelMe().then((me) => {
      setLoggedIn(Boolean(me?.loggedIn));
      if (me?.loggedIn) {
        void searchPanel("", 8).then((items) => setTop(items.slice(0, 8)));
        // Categorias do painel (filmes + séries) para o grid de exploração.
        void Promise.all([
          fetch(apiUrl("/api/panel/categories?kind=movie"), { cache: "no-store" }).then((r) =>
            r.ok ? r.json() : null,
          ),
          fetch(apiUrl("/api/panel/categories?kind=series"), { cache: "no-store" }).then((r) =>
            r.ok ? r.json() : null,
          ),
        ]).then(([movies, series]) => {
          const seen = new Set<string>();
          const out: Array<{ id: string; name: string; slug: string }> = [];
          for (const res of [movies, series]) {
            const list = Array.isArray(res?.categories) ? res.categories : [];
            for (const c of list) {
              if (
                typeof c?.slug === "string" &&
                typeof c?.name === "string" &&
                !seen.has(c.slug)
              ) {
                seen.add(c.slug);
                out.push({ id: String(c.id), name: c.name, slug: c.slug });
              }
            }
          }
          setPanelCategories(out);
        });
      }
    });
    return () => window.clearTimeout(t);
  }, [searchOpen]);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) {
      setResults([]);
      setSearched(false);
      setSearching(false);
      return;
    }
    setSearching(true);
    const timer = window.setTimeout(() => {
      void searchPanel(term, 24).then((items) => {
        setResults(items);
        setSearched(true);
        setSearching(false);
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const openResult = (entry: CatalogueEntry) => {
    setSearchOpen(false);
    router.push(panelPlayUrl(entry));
  };

  return (
    <AnimatePresence>
      {searchOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          className="fixed inset-0 z-[70] overflow-y-auto bg-[#0f1220]"
        >
          <div className="sticky top-0 z-10 border-b border-white/10 bg-[#0f1220]/95 backdrop-blur-xl">
            <div className="mx-auto flex h-[68px] w-full max-w-[1200px] items-center gap-4 px-4 md:px-8">
              <SearchIcon className="shrink-0 text-white/70" width={22} height={22} />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Buscar filmes e séries do seu servidor"
                className="h-full flex-1 bg-transparent text-lg text-white outline-none placeholder:text-white/40 md:text-2xl"
                aria-label="Buscar"
              />
              <button
                type="button"
                onClick={() => setSearchOpen(false)}
                aria-label="Fechar busca"
                className="focus-brand grid h-10 w-10 place-items-center rounded-full text-white/80 transition hover:bg-white/10 hover:text-white"
              >
                <CloseIcon width={22} height={22} />
              </button>
            </div>
          </div>

          <div className="mx-auto w-full max-w-[1200px] px-4 pb-24 pt-8 md:px-8">
            {loggedIn === false ? (
              <div className="mx-auto max-w-md py-10 text-center">
                <p className="text-[15px] font-semibold text-white">
                  Faça login para buscar no catálogo
                </p>
                <p className="mt-2 text-[13px] leading-relaxed text-white/55">
                  A busca mostra só os filmes e séries do seu servidor — entre com a
                  sua conta para procurar.
                </p>
                <Link
                  href={appUrl("/login")}
                  onClick={() => setSearchOpen(false)}
                  className="mt-5 inline-block rounded-md btn-neon px-5 py-2.5 text-[13.5px] font-semibold transition"
                >
                  Entrar / Criar conta
                </Link>
              </div>
            ) : query.trim().length === 0 ? (
              <>
                {top.length > 0 && (
                  <>
                    <h2 className="mb-4 text-lg font-semibold text-white">Mais buscados</h2>
                    <div className="mb-12 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {top.map((entry) => (
                        <button
                          key={entry.key}
                          type="button"
                          onClick={() => openResult(entry)}
                          className="group flex items-center gap-3 rounded-md p-2 text-left transition hover:bg-white/5"
                        >
                          <span className="relative h-20 w-[56px] shrink-0 overflow-hidden rounded bg-[#222]">
                            {entry.poster ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img
                                src={artUrl(entry.poster)}
                                alt={entry.name}
                                loading="lazy"
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <span className="grid h-full place-items-center bg-gradient-to-br from-white/15 to-transparent px-1 text-center text-[11px] text-white/70">
                                {entry.name}
                              </span>
                            )}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-white">
                              {entry.name}
                            </span>
                            <span className="block truncate text-xs text-white/45">
                              <SearchOverlayMeta entry={entry} />
                            </span>
                          </span>
                        </button>
                      ))}
                    </div>
                  </>
                )}

                {panelCategories.length > 0 && (
                  <>
                    <h2 className="mb-4 text-lg font-semibold text-white">
                      Explore as categorias do seu servidor
                    </h2>
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                      {panelCategories.map((category, i) => (
                        <Link
                          key={category.slug}
                          href={`/genre/${category.slug}`}
                          onClick={() => setSearchOpen(false)}
                          className="group relative grid h-[92px] place-items-center overflow-hidden rounded-md text-base font-semibold text-white transition hover:brightness-110"
                          style={{ backgroundColor: genreColors[i % genreColors.length] }}
                        >
                          <span className="absolute -right-4 -top-2 text-6xl opacity-25">
                            {category.name.slice(0, 1)}
                          </span>
                          <span className="relative z-10 px-3 text-center">{category.name}</span>
                        </Link>
                      ))}
                    </div>
                  </>
                )}
              </>
            ) : (
              <>
                <p className="mb-5 text-sm text-white/50">
                  {searching
                    ? `Buscando “${query}”…`
                    : results.length > 0
                      ? `${results.length} resultado${results.length === 1 ? "" : "s"} para “${query}”`
                      : searched
                        ? `Nenhum resultado para “${query}”`
                        : ""}
                </p>
                {searched && !searching && results.length === 0 ? (
                  <p className="max-w-md text-sm leading-relaxed text-white/60">
                    Nada com esse nome no seu servidor. Confira a ortografia ou tente
                    só uma parte do título — por exemplo, “vingadores” em vez do nome
                    completo.
                  </p>
                ) : (
                  <div className="grid grid-cols-3 gap-2.5 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
                    {results.map((entry, i) => (
                      <motion.button
                        key={entry.key}
                        type="button"
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: Math.min(i * 0.02, 0.3), duration: 0.3 }}
                        onClick={() => openResult(entry)}
                        className="group relative aspect-[2/3] overflow-hidden rounded-[4px] bg-[#222] ring-1 ring-white/5 transition duration-300 hover:z-10 hover:ring-white/40"
                      >
                        {entry.poster ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={artUrl(entry.poster)}
                            alt={entry.name}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="absolute inset-0 grid place-items-center bg-gradient-to-br from-[#2a2a2a] to-[#111] p-2 text-center">
                            <span>
                              <span className="block text-[34px] font-bold leading-none neon-text">
                                {(entry.name.trim()[0] ?? "?").toUpperCase()}
                              </span>
                              <span className="mt-2 block text-[11px] font-medium leading-tight text-white/80">
                                {entry.name}
                              </span>
                            </span>
                          </span>
                        )}
                        <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 to-transparent p-2 pt-8 text-left opacity-0 transition group-hover:opacity-100">
                          <span className="block text-xs font-medium text-white">{entry.name}</span>
                          <span className="block text-[10px] text-white/60">
                            <SearchOverlayMeta entry={entry} suffix=" · toque para assistir" />
                          </span>
                        </span>
                      </motion.button>
                    ))}
                    {searching &&
                      Array.from({ length: 6 }).map((_, index) => (
                        <div key={`search-skeleton-${index}`} className="animate-pulse">
                          <div className="aspect-[2/3] w-full rounded-[4px] bg-white/[0.06]" />
                        </div>
                      ))}
                  </div>
                )}
              </>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
