"use client";

import { Billboard } from "@/components/billboard";
import { Footer } from "@/components/footer";
import { Navbar } from "@/components/navbar";
import { AudienceShelves } from "@/components/audience-shelves";
import { LazySection } from "@/components/lazy-section";
import { PersonalRows } from "@/components/personal-rows";
import { Row, ContinueRow } from "@/components/row";
import { useStore, type WatchProgress } from "@/components/store";
import { dynamicRows, rows } from "@/data/rows";
import { getTitle, visibleFor } from "@/lib/catalog";
import { useEffect, useMemo, useState } from "react";
import {
  PanelHome,
  fetchPanelHomeBase,
  fetchPanelHomeTop10,
  type PanelHomeData,
} from "@/components/panel-home";

/**
 * Início com o catálogo curado (TMDB) — usada quando o usuário não está
 * logado ou o painel não tem filmes/séries. Quando o painel tem conteúdo,
 * a Início mostra SÓ o painel (ver PanelHome).
 *
 * tudo27 (item 8): as fileiras daqui ("Escolhas para você", "Infantil e
 * Família", "Em alta", "Top 10", "Originais CinePlus") são DIFERENTES das
 * da home logada DE PROPÓSITO — não é bug. O visitante não tem painel nem
 * conta: não há catálogo dele para mostrar, então ele vê o catálogo curado
 * de demonstração. Alinhar as duas seria mostrar ao visitante o painel de
 * outro usuário, ou esconder do assinante os 31 mil títulos do servidor
 * dele. Não mexer.
 */
function TmdbHome() {
  const { myList, profile, progress } = useStore();

  /* Continue Watching is built from real playback telemetry only — nothing is
     invented, so a row can never claim you watched something you didn't. */
  const continueSlugs = useMemo(() => {
    return (Object.entries(progress) as Array<[string, WatchProgress]>)
      .filter(([slug, p]) => {
        if (!p || typeof p.percent !== "number") return false;
        if (p.percent <= 0.015 || p.percent >= 0.97) return false;
        return Boolean(getTitle(slug));
      })
      .sort((a, b) => (b[1].updated ?? 0) - (a[1].updated ?? 0))
      .map(([slug]) => slug)
      .slice(0, 14);
  }, [progress]);

  const kids = Boolean(profile?.kids);
  const { settings } = useStore();
  const keepKidsSafe = useMemo(
    () => (slugs: string[]) =>
      kids || profile?.maturity !== "all" || settings.hideMature
        ? slugs.filter((slug) => {
            const title = getTitle(slug);
            return Boolean(title && visibleFor(title, profile, settings.hideMature));
          })
        : slugs,
    [kids, profile, settings.hideMature],
  );

  const shelves = useMemo(() => {
    const all = [...rows, ...dynamicRows];
    if (!kids) return all;
    return all
      .map((row) => ({ ...row, slugs: keepKidsSafe(row.slugs) }))
      .filter((row) => row.slugs.length >= 3);
  }, [kids, keepKidsSafe]);

  return (
    <>
      <Navbar />
      <main>
        <Billboard />

        <div className="relative z-10 pb-10">
          <ContinueRow slugs={keepKidsSafe(continueSlugs)} />

          {myList.length > 0 && (
            <ContinueRow
              slugs={myList.slice(0, 12)}
              title="Minha Lista"
              hint={`${myList.length} ${myList.length === 1 ? "título salvo" : "títulos salvos"}`}
              showProgress={false}
            />
          )}

          <PersonalRows />

          {/* kids/family, R-rated, and the 18+ shelf for All-maturity profiles */}
          <LazySection minHeight={320} rootMargin="900px">
            <AudienceShelves />
          </LazySection>

          {shelves.map((row, i) =>
            i < 3 ? (
              <Row key={row.id} row={row} priority={i < 2} />
            ) : (
              <LazySection key={row.id} minHeight={300}>
                <Row row={row} />
              </LazySection>
            ),
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}

export function HomePage() {
  const [mode, setMode] = useState<"checking" | "panel" | "tmdb" | "panel-error">("checking");
  const [panelData, setPanelData] = useState<PanelHomeData | null>(null);
  const [attempt, setAttempt] = useState(0);

  /* tudo27 (item 5): home em DOIS estágios — a base (herói + fileiras)
     aparece assim que chega, e o Top 10 completa depois. Antes, um único
     fetchPanelHomeData esperava base + Top 10 (com as chamadas de
     categoria) antes de mostrar qualquer coisa: 20–30 s de skeleton. */
  useEffect(() => {
    let alive = true;
    setMode("checking");
    void fetchPanelHomeBase().then(({ loggedIn, data }) => {
      if (!alive) return;
      if (data) {
        setPanelData(data);
        setMode("panel");
        /* estágio 2, em segundo plano: o Top 10 entra quando chegar — as
           fileiras aparecem sozinhas (lista vazia = fileira escondida). */
        void fetchPanelHomeTop10(data.movies, data.series).then((top) => {
          if (!alive) return;
          setPanelData((prev) => (prev ? { ...prev, ...top } : prev));
        });
      } else if (loggedIn) {
        /* logado mas o painel não devolveu nada: erro em PT-BR, nunca
           cair para o TMDB silenciosamente */
        setMode("panel-error");
      } else {
        setMode("tmdb");
      }
    });
    return () => {
      alive = false;
    };
  }, [attempt]);

  if (mode === "panel" && panelData) {
    return <PanelHome data={panelData} />;
  }

  if (mode === "checking") {
    return (
      <>
        <Navbar />
        <main>
          {/* skeleton da inicial: herói + fileiras, para a tela não parecer
              travada enquanto o catálogo do painel carrega */}
          <div className="relative h-[74svh] min-h-[440px] w-full animate-pulse bg-[#1b1b1b] md:h-[88svh] md:min-h-[560px]">
            <div className="absolute inset-x-0 bottom-[13%] px-4 md:px-12">
              <div className="h-4 w-32 rounded bg-white/10" />
              <div className="mt-4 h-12 w-3/4 max-w-[520px] rounded bg-white/10 md:h-16" />
              <div className="mt-4 h-4 w-56 rounded bg-white/10" />
              <div className="mt-7 h-12 w-36 rounded bg-white/10" />
            </div>
          </div>
          <div className="relative z-10 pb-10">
            <p className="px-4 pb-2 pt-4 text-[13px] text-white/50 md:px-12">
              Carregando seu catálogo…
            </p>
            {[0, 1].map((row) => (
              <div key={row} className="py-3 md:py-4">
                <div className="mb-2 px-4 md:px-12">
                  <div className="h-5 w-32 rounded bg-white/10" />
                </div>
                <div className="flex gap-2 overflow-hidden px-4 md:px-12">
                  {Array.from({ length: 8 }).map((_, i) => (
                    <div
                      key={i}
                      className="aspect-[2/3] w-[186px] shrink-0 animate-pulse rounded-[4px] bg-white/[0.06]"
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </main>
        <Footer />
      </>
    );
  }

  if (mode === "panel-error") {
    return (
      <>
        <Navbar />
        <main className="grid min-h-[70vh] place-items-center px-6">
          <div className="max-w-md text-center">
            <p className="text-[15px] font-semibold text-white">
              Não foi possível carregar o catálogo do seu servidor
            </p>
            <p className="mt-2 text-[13px] leading-relaxed text-white/55">
              O painel não respondeu agora. Confira sua conexão e tente
              novamente — seus filmes e séries aparecem aqui quando o painel
              voltar.
            </p>
            <button
              type="button"
              onClick={() => setAttempt((n) => n + 1)}
              className="mt-5 rounded-md bg-white px-5 py-2.5 text-[13.5px] font-semibold text-black transition hover:bg-white/85"
            >
              Tentar novamente
            </button>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  return <TmdbHome />;
}
