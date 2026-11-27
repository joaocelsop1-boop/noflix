import type { Metadata } from "next";
import { LiveCatalogue } from "@/components/live-catalogue";

export const metadata: Metadata = {
  title: "Filmes — MineTV",
  description: "1,000 films ready to stream, popularity ordered and refreshed every few hours.",
};

export default function Page() {
  return <LiveCatalogue initialTab="movie" heading="Filmes" />;
}
