"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const columns = [
  [
    { label: "Início", href: "/" },
    { label: "Séries", href: "/tv-shows" },
    { label: "Filmes", href: "/movies" },
    { label: "Anime", href: "/anime" },
  ],
  [
    { label: "Ver todos os títulos", href: "/browse" },
    { label: "Minha Lista", href: "/my-list" },
    { label: "Novidades", href: "/new-popular" },
  ],
  [
    { label: "Configurações", href: "/settings" },
    { label: "Aparência", href: "/settings?tab=appearance" },
    { label: "Sobre a CinePlus", href: "/about" },
  ],
  [
    { label: "Política de privacidade", href: "/privacy" },
    { label: "Termos de uso", href: "/terms" },
    { label: "Direitos autorais e DMCA", href: "/dmca" },
  ],
];

export function Footer() {
  /** Links de categorias DO PAINEL (filmes + séries) — nada de gênero TMDB. */
  const [panelCategories, setPanelCategories] = useState<
    Array<{ name: string; slug: string }>
  >([]);

  useEffect(() => {
    let alive = true;
    void Promise.all([
      fetch("/api/panel/categories?kind=movie", { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : null,
      ),
      fetch("/api/panel/categories?kind=series", { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : null,
      ),
    ])
      .then(([movies, series]) => {
        if (!alive) return;
        const seen = new Set<string>();
        const out: Array<{ name: string; slug: string }> = [];
        for (const res of [movies, series]) {
          const list = Array.isArray(res?.categories) ? res.categories : [];
          for (const c of list) {
            if (
              typeof c?.slug === "string" &&
              typeof c?.name === "string" &&
              !seen.has(c.slug)
            ) {
              seen.add(c.slug);
              out.push({ name: c.name, slug: c.slug });
            }
          }
        }
        setPanelCategories(out.slice(0, 12));
      })
      .catch(() => {
        if (alive) setPanelCategories([]);
      });
    return () => {
      alive = false;
    };
  }, []);

  return (
    <footer className="mt-10 border-t border-white/5 px-4 pb-16 pt-10 text-[13px] text-[#808080] md:px-12">
      <div className="mx-auto max-w-[1100px]">
        <div className="mb-6 flex items-center gap-4 text-white/80">
          <a
            href="/about"
            className="rounded-full border border-white/25 px-3 py-1 text-[11px] uppercase tracking-wider transition hover:border-white/60 hover:text-white"
          >
            Sobre a CinePlus
          </a>
        </div>

        <div className="grid grid-cols-2 gap-y-3 sm:grid-cols-4">
          {columns.map((col, i) => (
            <div key={i} className="flex flex-col gap-3">
              {col.map((link) => (
                <Link key={link.label} href={link.href} className="transition hover:text-white hover:underline">
                  {link.label}
                </Link>
              ))}
            </div>
          ))}
        </div>

        {panelCategories.length > 0 && (
          <div className="mt-8 flex flex-wrap gap-2">
            {panelCategories.map((category) => (
              <Link
                key={category.slug}
                href={`/genre/${category.slug}`}
                className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-white/50 transition hover:border-white/40 hover:text-white"
              >
                {category.name}
              </Link>
            ))}
          </div>
        )}

        <div className="mt-8 space-y-2 text-[11px] leading-relaxed text-white/35">
          <p>
            CinePlus — filmes, séries e anime, tudo em um só lugar.
          </p>
          <p className="pt-2">CinePlus</p>
        </div>
      </div>
    </footer>
  );
}
