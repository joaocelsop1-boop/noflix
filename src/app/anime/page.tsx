import type { Metadata } from "next";
import { LiveCatalogue } from "@/components/live-catalogue";

export const metadata: Metadata = {
  title: "Anime — CinePlus",
  description: "Animes do seu servidor, legendados e dublados.",
};

/**
 * Anime agora mostra SÓ o catálogo do painel (aba anime) — antes tinha as
 * fileiras LiveRows (TMDB/Jikan) acima, que não são o conteúdo do usuário.
 */
export default function Page() {
  return <LiveCatalogue initialTab="anime" heading="Anime" />;
}
