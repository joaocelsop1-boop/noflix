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
  fetchPanelHomeData,
  type PanelHomeData,
} from "@/components/panel-home";

/**
 * Início com o catálogo curado (TMDB) — usada quando o usuário não está
 * logado ou o painel não tem filmes/séries. Quando o painel tem conteúdo,
 * a Início mostra SÓ o painel (ver PanelHome).
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

        <div className="relative z-10 -mt-[9vh] pb-10">
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
  const [mode, setMode] = useState<"checking" | "panel" | "tmdb">("checking");
  const [panelData, setPanelData] = useState<PanelHomeData | null>(null);

  useEffect(() => {
    let alive = true;
    void fetchPanelHomeData().then((data) => {
      if (!alive) return;
      if (data) {
        setPanelData(data);
        setMode("panel");
      } else {
        setMode("tmdb");
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  if (mode === "panel" && panelData) {
    return <PanelHome data={panelData} />;
  }

  if (mode === "checking") {
    return (
      <>
        <Navbar />
        <main className="flex min-h-[70vh] items-center justify-center">
          <p className="text-[14px] text-white/50">Carregando seu catálogo…</p>
        </main>
        <Footer />
      </>
    );
  }

  return <TmdbHome />;
}
