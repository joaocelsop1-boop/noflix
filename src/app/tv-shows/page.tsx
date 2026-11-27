import type { Metadata } from "next";
import { LiveCatalogue } from "@/components/live-catalogue";

export const metadata: Metadata = {
  title: "Séries — CinePlus",
  description: "Séries do seu servidor, prontas para maratonar.",
};

export default function Page() {
  return <LiveCatalogue initialTab="series" heading="Séries" />;
}
