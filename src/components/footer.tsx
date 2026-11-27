"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import {apiUrl, appUrl} from "@/lib/paths";
import { supportUrl } from "@/lib/support";
import { usePanelMe } from "@/lib/use-panel-me";
import { Wordmark } from "@/components/wordmark";

const columns = [
  [
    { label: "Início", href: appUrl("/") },
    { label: "Séries", href: appUrl("/tv-shows") },
    { label: "Filmes", href: appUrl("/movies") },
    { label: "Anime", href: appUrl("/anime") },
  ],
  [
    { label: "Ver todos os títulos", href: appUrl("/browse") },
    { label: "Minha Lista", href: appUrl("/my-list") },
    { label: "Novidades", href: appUrl("/new-popular") },
  ],
  [
    { label: "Configurações", href: appUrl("/settings") },
    { label: "Aparência", href: appUrl("/settings?tab=appearance") },
    { label: "Sobre a CinePlus", href: appUrl("/about") },
  ],
  [
    { label: "Política de privacidade", href: appUrl("/privacy") },
    { label: "Termos de uso", href: appUrl("/terms") },
    { label: "Direitos autorais e DMCA", href: appUrl("/dmca") },
  ],
];

export function Footer() {
  /** Links de categorias DO PAINEL (filmes + séries) — nada de gênero TMDB. */
  const [panelCategories, setPanelCategories] = useState<
    Array<{ name: string; slug: string }>
  >([]);
  /** Contato de suporte (admin): o botão só aparece quando preenchido. */
  const { me } = usePanelMe();
  const support = supportUrl(me?.support?.whatsapp, me?.support?.telegram);

  useEffect(() => {
    let alive = true;
    void Promise.all([
      fetch(apiUrl("/api/panel/categories?kind=movie"), { cache: "no-store" }).then((r) =>
        r.ok ? r.json() : null,
      ),
      fetch(apiUrl("/api/panel/categories?kind=series"), { cache: "no-store" }).then((r) =>
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

  /* tudo26: rodapé refeito — o texto frio "CinePlus — filmes, séries e
     anime, tudo em um só lugar. CinePlus" saiu. Agora: marca grande, frase
     acolhedora, botões de ação em destaque (baixar o app e suporte) e os
     links de sempre. O suporte também aparece aqui, grande e visível. */
  const supportIsWhatsApp = Boolean(support?.includes("wa.me"));
  return (
    <footer className="mt-10 border-t border-white/5 bg-[#0a0d18] px-4 pb-16 pt-10 text-[13px] text-[#808080] md:px-12">
      <div className="mx-auto max-w-[1100px]">
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <Wordmark className="text-[28px] md:text-[32px]" />
            <p className="mt-2 max-w-[440px] text-[13px] leading-relaxed text-white/60">
              Seus filmes e séries favoritos em um só lugar — assista quando
              quiser, de onde estiver.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <a
              href={appUrl("/cineplus.apk")}
              download
              className="flex items-center gap-2 rounded-full bg-[#e50914] px-5 py-2.5 text-[13px] font-bold text-white shadow-[0_8px_24px_rgba(229,9,20,0.4)] transition hover:bg-[#f6121f]"
            >
              Baixar aplicativo
            </a>
            {support && (
              <a
                href={support}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-full bg-[#25d366] px-5 py-2.5 text-[13px] font-bold text-[#062b16] transition hover:brightness-110"
              >
                {supportIsWhatsApp ? "Falar no WhatsApp" : "Falar no Telegram"}
              </a>
            )}
          </div>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-y-3 sm:grid-cols-4">
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

        <div className="mt-8 flex flex-col gap-1 border-t border-white/5 pt-5 text-[11px] leading-relaxed text-white/35 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} CinePlus — todos os direitos reservados.</p>
          <p>Feito para quem ama cinema e séries.</p>
        </div>
      </div>
    </footer>
  );
}
