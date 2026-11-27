"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, type CSSProperties } from "react";
import { Footer } from "@/components/footer";
import { Navbar } from "@/components/navbar";
import { PanelPosterCard } from "@/components/panel-home";
import { SearchIcon } from "@/components/icons";
import { apiUrl, appUrl } from "@/lib/paths";
import type { CatalogueEntry } from "@/lib/catalogue";

/**
 * tudo27 (item 4): a página /app/search NÃO EXISTIA — /app/search?q=...
 * caía no not-found (NSES-404). Só havia o overlay de busca e a API
 * /api/search. Esta página usa a mesma fonte (catálogo do painel, via
 * /api/search — filmes + séries), com os mesmos cartões da home
 * (PanelPosterCard: pôster do TMDB, título limpo, nota, clique abre o
 * detalhe). A busca é ao vivo enquanto digita (debounce 400 ms) e a URL
 * fica partilhável (?q=...).
 */
export function SearchPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const q = (searchParams.get("q") ?? "").trim();
  const [input, setInput] = useState(q);
  const [results, setResults] = useState<CatalogueEntry[]>([]);
  const [searching, setSearching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [failed, setFailed] = useState(false);

  /* o campo segue a URL (voltar/avançar do navegador, link partilhado) */
  useEffect(() => {
    setInput(q);
  }, [q]);

  /* digitar atualiza a URL com debounce — a busca em si lê a URL */
  useEffect(() => {
    if (input.trim() === q) return;
    const t = window.setTimeout(() => {
      const value = input.trim();
      router.replace(
        value ? appUrl(`/search?q=${encodeURIComponent(value)}`) : appUrl("/search"),
        { scroll: false },
      );
    }, 400);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  /* busca no painel quando o termo da URL muda */
  useEffect(() => {
    if (!q) {
      setResults([]);
      setSearched(false);
      setFailed(false);
      setSearching(false);
      return;
    }
    let alive = true;
    setSearching(true);
    setFailed(false);
    void fetch(apiUrl(`/api/search?q=${encodeURIComponent(q)}`), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive) return;
        const local = (data?.local ?? []) as CatalogueEntry[];
        setResults(Array.isArray(local) ? local : []);
        setSearched(true);
        setSearching(false);
      })
      .catch(() => {
        if (!alive) return;
        setResults([]);
        setSearched(true);
        setFailed(true);
        setSearching(false);
      });
    return () => {
      alive = false;
    };
  }, [q]);

  return (
    <>
      <Navbar />
      <main className="mx-auto min-h-[70vh] w-full max-w-[1400px] px-4 pb-10 pt-24 md:px-8">
        <h1 className="text-2xl font-bold text-white md:text-3xl">Buscar</h1>
        <p className="mt-1 text-sm text-white/55">
          Filmes e séries do seu servidor — o que aparece aqui é o que toca.
        </p>

        <form
          className="mt-5 flex max-w-xl items-center gap-2 rounded-lg border border-white/15 bg-black/50 px-3 py-2.5 focus-within:border-white/40"
          onSubmit={(e) => {
            e.preventDefault();
            const value = input.trim();
            router.replace(
              value ? appUrl(`/search?q=${encodeURIComponent(value)}`) : appUrl("/search"),
            );
          }}
        >
          <SearchIcon width={18} height={18} className="shrink-0 text-white/50" />
          <input
            type="search"
            value={input}
            autoFocus
            onChange={(e) => setInput(e.target.value)}
            placeholder="Buscar título…"
            aria-label="Buscar título"
            className="w-full bg-transparent text-sm text-white outline-none placeholder:text-white/35"
          />
          {input && (
            <button
              type="button"
              onClick={() => setInput("")}
              aria-label="Limpar busca"
              className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/70 hover:bg-white/20"
            >
              Limpar
            </button>
          )}
        </form>

        {searching && (
          <div className="mt-8 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 md:gap-3 lg:grid-cols-6 xl:grid-cols-7">
            {Array.from({ length: 14 }).map((_, i) => (
              <div key={i} className="aspect-[2/3] animate-pulse rounded-lg bg-white/10" />
            ))}
          </div>
        )}

        {!searching && searched && failed && (
          <div className="mt-10 rounded-xl border border-white/10 bg-white/5 p-6 text-center">
            <p className="font-semibold text-white">Não foi possível buscar agora.</p>
            <p className="mt-1 text-sm text-white/60">
              O servidor demorou ou está fora — tente de novo.
            </p>
            <button
              type="button"
              onClick={() => router.refresh()}
              className="mt-4 rounded-md bg-[#e50914] px-5 py-2.5 text-sm font-bold text-white transition hover:bg-[#f6121f]"
            >
              Tentar novamente
            </button>
          </div>
        )}

        {!searching && searched && !failed && results.length === 0 && (
          <div className="mt-10 text-center">
            <p className="text-lg font-semibold text-white">
              Nenhum título encontrado para &ldquo;{q}&rdquo;.
            </p>
            <p className="mt-1 text-sm text-white/55">
              Confira a grafia ou tente só parte do nome.
            </p>
          </div>
        )}

        {!searching && !failed && results.length > 0 && (
          <>
            <p className="mt-6 text-sm text-white/55">
              {results.length} {results.length === 1 ? "resultado" : "resultados"} para &ldquo;{q}&rdquo;
            </p>
            <div
              className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 md:gap-3 lg:grid-cols-6 xl:grid-cols-7"
              style={{ "--nf-card-w": "100%" } as CSSProperties}
            >
              {results.map((entry) => (
                <PanelPosterCard key={entry.key} entry={entry} />
              ))}
            </div>
          </>
        )}

        {!searching && !searched && !q && (
          <p className="mt-10 text-center text-sm text-white/45">
            Digite o nome de um filme ou série acima.
          </p>
        )}
      </main>
      <Footer />
    </>
  );
}
