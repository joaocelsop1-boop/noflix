import type { Metadata } from "next";
import { LiveCatalogue } from "@/components/live-catalogue";

export const metadata: Metadata = {
  title: "Filmes — CinePlus",
  description: "Filmes do seu servidor, prontos para assistir.",
};

export default function Page() {
  return <LiveCatalogue initialTab="movie" heading="Filmes" />;
}
