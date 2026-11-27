import type { Metadata } from "next";
import { Suspense } from "react";
import { SearchPage } from "@/components/search-page";
import { Navbar } from "@/components/navbar";

export const metadata: Metadata = {
  title: "Buscar — CinePlus",
  description: "Busque filmes e séries do seu servidor.",
};

/**
 * tudo27 (item 4): a rota /app/search não existia (404 NSES-404). O
 * Suspense é obrigatório aqui: o SearchPage lê useSearchParams() e o
 * Next.js exige a fronteira na página.
 */
export default function Page() {
  return (
    <Suspense
      fallback={
        <>
          <Navbar />
          <main className="mx-auto w-full max-w-[1400px] px-4 pb-10 pt-24 md:px-8">
            <div className="h-8 w-40 animate-pulse rounded bg-white/10" />
            <div className="mt-5 h-11 w-full max-w-xl animate-pulse rounded-lg bg-white/10" />
            <div className="mt-8 grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5 md:gap-3 lg:grid-cols-6 xl:grid-cols-7">
              {Array.from({ length: 14 }).map((_, i) => (
                <div key={i} className="aspect-[2/3] animate-pulse rounded-lg bg-white/10" />
              ))}
            </div>
          </main>
        </>
      }
    >
      <SearchPage />
    </Suspense>
  );
}
