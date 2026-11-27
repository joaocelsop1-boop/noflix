import Link from "next/link";
import { genres, genreSlug } from "@/lib/catalog";

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
    { label: "Status do desenvolvedor", href: "/settings?tab=developer" },
    { label: "Sobre a MineTV", href: "/about" },
  ],
  [
    { label: "Política de privacidade", href: "/privacy" },
    { label: "Termos de uso", href: "/terms" },
    { label: "Direitos autorais e DMCA", href: "/dmca" },
    { label: "Código no GitHub", href: "https://github.com/sdlksdsf/Movie" },
  ],
];

export function Footer() {
  return (
    <footer className="mt-10 border-t border-white/5 px-4 pb-16 pt-10 text-[13px] text-[#808080] md:px-12">
      <div className="mx-auto max-w-[1100px]">
        <div className="mb-6 flex items-center gap-4 text-white/80">
          <a
          href="https://github.com/sdlksdsf/Movie"
          target="_blank"
          rel="noreferrer"
          className="rounded-full border border-white/25 px-3 py-1 text-[11px] uppercase tracking-wider transition hover:border-white/60 hover:text-white"
        >
          GitHub ↗
        </a>
        <a
          href="/about"
          className="rounded-full border border-white/25 px-3 py-1 text-[11px] uppercase tracking-wider transition hover:border-white/60 hover:text-white"
        >
          Sobre a MineTV
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

        <div className="mt-8 flex flex-wrap gap-2">
          {genres.slice(0, 12).map((genre) => (
            <Link
              key={genre}
              href={`/genre/${genreSlug(genre)}`}
              className="rounded-full border border-white/10 px-3 py-1 text-[11px] text-white/50 transition hover:border-white/40 hover:text-white"
            >
              {genre}
            </Link>
          ))}
        </div>

        <div className="mt-8 space-y-2 text-[11px] leading-relaxed text-white/35">
          <p>
            Uma demonstração inspirada na MineTV, feita com Next.js, Tailwind CSS e Framer Motion. Todos os títulos,
            artes e metadados pertencem aos seus respectivos detentores de direitos.
          </p>
          <p>
            A reprodução é entregue pelo player de terceiros CineLite. Se um stream não iniciar,
            a fonte pode estar temporariamente indisponível — tente outro título ou servidor.
          </p>
          <p className="pt-2">MineTV</p>
        </div>
      </div>
    </footer>
  );
}
