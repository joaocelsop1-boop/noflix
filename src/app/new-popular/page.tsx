import type { Metadata } from "next";
import { LiveCatalogue } from "@/components/live-catalogue";

export const metadata: Metadata = { title: "Novidades — CinePlus" };

/**
 * Novidades agora mostra o catálogo DO PAINEL — antes mostrava o Top 10
 * curado (TMDB), que não é o conteúdo do usuário.
 */
export default function Page() {
  return <LiveCatalogue heading="Novidades" />;
}
