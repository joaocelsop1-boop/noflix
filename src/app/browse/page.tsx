import type { Metadata } from "next";
import { LiveCatalogue } from "@/components/live-catalogue";

export const metadata: Metadata = { title: "Navegar pelo catálogo completo — CinePlus" };

export default function Page() {
  return (
    <>
      <LiveCatalogue />
      <noscript>
        <p className="px-4 pb-10 text-center text-sm text-white/60">
          Ative o JavaScript para navegar pelo catálogo.
        </p>
      </noscript>
    </>
  );
}
