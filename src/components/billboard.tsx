"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Artwork } from "@/components/artwork";
import { CheckIcon, InfoIcon, PlayIcon, PlusIcon } from "@/components/icons";
import { useStore } from "@/components/store";
import { heroTitles, shortMeta } from "@/lib/catalog";
import { cn } from "@/lib/cn";
import { appUrl } from "@/lib/paths";

/** how long each banner holds the stage */
const ROTATE_MS = 15000;

const stagger = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.05 } },
};

const rise = {
  hidden: { opacity: 0, y: 26 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: [0.16, 1, 0.3, 1] as const } },
};

/**
 * Rotating hero. Nine banners (series · films · anime) cycle on their own —
 * no hover freeze, so it is always visibly moving, and every layer carries its
 * own backdrop *and* its own copy, so the art can never disagree with the text.
 */
export function Billboard() {
  const features = useMemo(() => heroTitles(9), []);
  const [index, setIndex] = useState(0);
  const router = useRouter();
  const { openTitle, inList, toggleList, toast } = useStore();
  const timer = useRef<number | null>(null);

  const active = features[index] ?? features[0];

  const go = useCallback(
    (next: number) => {
      if (features.length === 0) return;
      setIndex(((next % features.length) + features.length) % features.length);
    },
    [features.length],
  );

  /* the slideshow never stops on its own — a background tab resumes on return */
  useEffect(() => {
    if (features.length < 2) return;
    const arm = () => {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setIndex((i) => (i + 1) % features.length), ROTATE_MS);
    };
    arm();
    const onVisible = () => {
      if (document.visibilityState === "visible") arm();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [index, features.length]);

  if (!active) return null;

  const saved = inList(active.slug);

  return (
    <section className="relative h-[80svh] min-h-[520px] w-full overflow-hidden md:h-[88svh] md:min-h-[560px]">
      {/* per-slide backdrop — cross-fades, never leaves a black hole */}
      <AnimatePresence initial={false}>
        <motion.div
          key={`bg-${active.slug}`}
          /* starts at full opacity: if the animation never runs (or the slide
             never mounts cleanly) the backdrop is still there */
          initial={{ opacity: 1, scale: 1.06 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={{ opacity: 0, transition: { duration: 0.55, ease: "easeIn" } }}
          transition={{ opacity: { duration: 0.9, ease: "easeOut" }, scale: { duration: 9, ease: "linear" } }}
          className="absolute inset-0"
        >
          <Artwork
            slug={active.slug}
            name={active.name}
            kind="backdrop"
            accent={active.accent}
            tmdbId={active.tmdbId}
            priority
            sizes="100vw"
          />
        </motion.div>
      </AnimatePresence>

      {/* colour wash from the title's accent + vignette */}
      <AnimatePresence initial={false}>
        <motion.div
          key={`wash-${active.slug}`}
          initial={{ opacity: 1 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 1.4 }}
          className="absolute inset-0"
          style={{
            background: `radial-gradient(120% 90% at 15% 100%, ${active.accent}2e, transparent 62%)`,
          }}
        />
      </AnimatePresence>

      <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-[#141414]/25 to-transparent" />
      <div className="absolute inset-0 bg-gradient-to-r from-[#141414] via-[#141414]/55 to-transparent" />
      <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-black/80 to-transparent" />

      {/* content — one keyed block, so backdrop and copy always agree */}
      <div className="absolute inset-x-0 bottom-[18%] z-10 px-4 md:bottom-[21%] md:px-12">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={`copy-${active.slug}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.18 } }}
            transition={{ duration: 0.24, delay: 0.3 }}
            className="max-w-[640px]"
          >
            <motion.div variants={stagger} initial="hidden" animate="show">
              <motion.div variants={rise} className="mb-3">
                <span className="rounded-sm bg-[#e50914] px-2 py-1 text-[10px] font-bold uppercase tracking-[0.18em] text-white">
                  {active.anime ? "Anime" : active.kind === "series" ? "Série" : "Filme"}
                </span>
                {active.badge && (
                  <span className="ml-2 rounded-sm bg-[var(--nf-accent)] px-1.5 py-1 text-[9px] font-bold tracking-[0.12em] text-white">
                    {active.badge}
                  </span>
                )}
              </motion.div>

              <motion.h1
                variants={rise}
                className="font-display text-[clamp(1.9rem,6vw,5.2rem)] leading-[0.92] tracking-[0.01em] text-white drop-shadow-[0_6px_30px_rgba(0,0,0,0.7)]"
              >
                {active.name}
              </motion.h1>

              <motion.div
                variants={rise}
                className="mt-4 flex flex-wrap items-center gap-3 text-[13px] text-white/85"
              >
                <span className="font-semibold text-[#46d369]">{active.match}% Match</span>
                {active.rating ? (
                  <span className="flex items-center gap-1 font-semibold text-white">
                    <span className="text-[#ffc107]">★</span>
                    {active.rating.toFixed(1)}
                  </span>
                ) : null}
                <span>{active.year}</span>
                <span className="rounded border border-white/40 px-1.5 py-[1px] text-[11px] uppercase tracking-wide">
                  {active.maturity}
                </span>
                <span>{shortMeta(active)}</span>
                <span className="hidden rounded bg-white/15 px-1.5 py-[1px] text-[10px] font-semibold uppercase tracking-[0.16em] sm:inline">
                  HD
                </span>
              </motion.div>

              <motion.p
                variants={rise}
                className="mt-4 line-clamp-3 hidden max-w-[520px] text-[13.5px] leading-relaxed text-white/85 [text-shadow:0_2px_10px_rgba(0,0,0,0.8)] sm:block md:text-[15px]"
              >
                {active.overview}
              </motion.p>

              <motion.div variants={rise} className="mt-7 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={() => router.push(appUrl(`/watch/${active.kind}/${active.slug}`))}
                  className="focus-brand flex items-center gap-2.5 rounded-full bg-[#e50914] px-6 py-3 text-[15px] font-bold text-white shadow-[0_8px_30px_rgba(229,9,20,0.45)] transition duration-200 hover:bg-[#f6121f] active:scale-[0.98]"
                >
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-white">
                    <PlayIcon width={12} height={12} className="text-[#e50914]" />
                  </span>
                  Assistir Agora
                </button>
                <button
                  type="button"
                  onClick={() => openTitle(active.slug)}
                  className="focus-brand flex items-center gap-2 rounded-[4px] bg-white/20 px-6 py-3 text-[15px] font-semibold text-white backdrop-blur-sm transition duration-200 hover:bg-white/30 active:scale-[0.98]"
                >
                  <InfoIcon width={20} height={20} />
                  Mais informações
                </button>
                <button
                  type="button"
                  aria-label={saved ? "Remover da Minha Lista" : "Adicionar à Minha Lista"}
                  onClick={() => {
                    toggleList(active.slug);
                    toast(saved ? "Removido da Minha Lista" : "Adicionado à Minha Lista");
                  }}
                  className={cn(
                    "focus-brand grid h-11 w-11 place-items-center rounded-full border transition duration-200",
                    saved
                      ? "border-white bg-white text-black"
                      : "border-white/50 bg-black/40 text-white hover:border-white hover:bg-white/15",
                  )}
                >
                  {saved ? <CheckIcon width={19} height={19} /> : <PlusIcon width={19} height={19} />}
                </button>
              </motion.div>
            </motion.div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* genre / rating plate */}
      <div className="absolute bottom-[19%] right-0 z-10 hidden items-center gap-3 border-l-2 border-white/70 bg-black/40 py-2 pl-3 pr-8 text-[13px] text-white/85 md:flex">
        <span className="rounded border border-white/50 px-1.5 py-[1px] text-[11px]">{active.maturity}</span>
        <span className="max-w-[240px] text-white/70">
          {active.genres.join(" · ")} · {active.format}
        </span>
      </div>

      {/* miniaturas circulares dos destaques (estilo Pobreflix) — elas SAO a
          navegacao do carrossel: a ativa ganha anel branco, clicar troca na hora.
          tudo24: z-20 — nada pode cobrir as bolinhas e roubar o clique. */}
      <div className="absolute inset-x-0 bottom-3 z-20 flex justify-center md:bottom-5">
        <div className="no-scrollbar flex max-w-full items-center gap-2 overflow-x-auto px-4 md:gap-3">
          {features.map((f, i) => (
            <button
              key={f.slug}
              type="button"
              aria-label={`Mostrar ${f.name}`}
              aria-current={i === index}
              onClick={() => go(i)}
              className={cn(
                "h-11 w-11 shrink-0 overflow-hidden rounded-full transition md:h-[52px] md:w-[52px]",
                i === index
                  ? "ring-2 ring-white ring-offset-2 ring-offset-black/60"
                  : "opacity-70 ring-1 ring-white/30 hover:opacity-100 hover:ring-white/60",
              )}
            >
              <Artwork
                slug={f.slug}
                name={f.name}
                kind="poster"
                accent={f.accent}
                tmdbId={f.tmdbId}
                sizes="60px"
              />
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}
