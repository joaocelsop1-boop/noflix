"use client";

import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  CloseIcon,
  ListIcon,
  NextIcon,
  PlayIcon,
  SubtitlesIcon,
} from "@/components/icons";
import { useStore } from "@/components/store";
import { cleanTitle } from "@/lib/title-clean";
import { useTmdbMeta } from "@/lib/tmdb-client";
import { Wordmark } from "@/components/wordmark";
import { Artwork } from "@/components/artwork";
import { shortMeta } from "@/lib/catalog";
import { moreLikeThis } from "@/lib/taste";
import {
  DEFAULT_PLAYER,
  DEFAULT_QUALITY,
  PLAYERS,
  QUALITIES,
  buildSrc,
  canPlay,
  isPlayerId,
  otherPlayer,
  playerMeta,
  resolvePlayer,
  playOrder,
  isAnimeTitle,
  playerMeta as metaOf,
  type AudioTrack,
  type PlayerId,
  type Quality,
} from "@/lib/players";
import { anilistIdFor } from "@/lib/anime-ids";
import { NativePlayer, type NativeSource } from "@/components/native-player";
import {apiUrl, appUrl} from "@/lib/paths";
import { PlanGate } from "@/components/plan-gate";
import { PanelPosterCard } from "@/components/panel-home";
import type { TmdbCastMember } from "@/lib/tmdb-types";
import type { CatalogueEntry } from "@/lib/catalogue";
import { fetchPanelMe, fetchPanelInfo } from "@/lib/panel";
import type { Season, Title } from "@/lib/types";
import { cn } from "@/lib/cn";

/**
 * One player, one layer.
 *
 * Playback itself belongs to the third-party embed in the iframe — play/pause,
 * seek, volume, subtitles, audio and fullscreen live in *its* bottom bar. We
 * never draw a second control strip over it.
 *
 * Our chrome only covers what the embed can't do:
 *   source switching (frameXTV default, CineLite backup) · next episode /
 *   auto-advance · seasons · back · resume position · pause suggestions.
 */

const ls = {
  get(key: string) {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return null;
    }
  },
  set(key: string, value: string) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* ignore */
    }
  },
};

type Tick = {
  current: number;
  total: number;
  completed: boolean;
  season?: number | null;
  episode?: number | null;
};

/** Accept any provider's tick shape — both embeds post different envelopes. */
function readTick(data: unknown): Tick | null {
  if (!data || typeof data !== "object") return null;
  const raw = data as Record<string, unknown>;

  const payload = (raw.payload as Record<string, unknown> | undefined) ?? raw;

  const current = Number(payload.currentTime ?? payload.current ?? payload.time);
  const total = Number(payload.duration);
  if (!Number.isFinite(current)) return null;
  if (!Number.isFinite(total) || total <= 0) {
    if (!Number.isFinite(current) || current <= 0) return null;
  }

  const pct = Number(payload.progress);
  const completed =
    Boolean(payload.completed) ||
    (Number.isFinite(pct) && pct >= 99.4) ||
    (total > 0 && current / total >= 0.995);

  return {
    current,
    total: Number.isFinite(total) ? total : 0,
    completed,
    season: (payload.season as number | null | undefined) ?? null,
    episode: (payload.episode as number | null | undefined) ?? null,
  };
}

/**
 * Next episode after `season`/`episode`, wrapping into the following season.
 * Compares episode *numbers*, not positions, because TMDB leaves gaps, and
 * walks the season list in order so a missing or sparse season (specials, a
 * split cour, a season with no episodes loaded) does not dead-end playback.
 */
function nextEpisodeOf(seasons: Season[], season: number, episode: number) {
  const ordered = [...seasons].sort((a, b) => a.number - b.number);
  const current = ordered.find((s) => s.number === season);
  const later = current?.episodes
    .filter((entry) => entry.number > episode)
    .sort((a, b) => a.number - b.number)[0];
  if (later) return { season, episode: later.number };
  const nextSeason = ordered.find((s) => s.number > season && s.episodes.length > 0);
  if (!nextSeason) return null;
  const first = [...nextSeason.episodes].sort((a, b) => a.number - b.number)[0];
  return first ? { season: nextSeason.number, episode: first.number } : null;
}

/** tudo26: minutos -> "1h17" / "45 min" (aviso de filme errado). */
function formatMinutes(min: number): string {
  if (min >= 60) return `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}`;
  return `${min} min`;
}

/* tudo26: um membro do elenco — foto redonda (via /api/img) ou círculo
   com a inicial quando não há foto; nome + personagem. */
function CastMember({ member }: { member: TmdbCastMember }) {
  const [photoBroken, setPhotoBroken] = useState(false);
  const initial = member.name.trim().charAt(0).toUpperCase();
  return (
    <div className="w-[88px] shrink-0 text-center">
      <div className="mx-auto grid h-16 w-16 place-items-center overflow-hidden rounded-full bg-white/10 ring-1 ring-white/10">
        {member.photo && !photoBroken ? (
          <img
            src={apiUrl(`/api/img?u=${encodeURIComponent(member.photo)}`)}
            alt={member.name}
            loading="lazy"
            className="h-full w-full object-cover"
            onError={() => setPhotoBroken(true)}
          />
        ) : (
          <span className="text-xl font-bold text-white/70">{initial}</span>
        )}
      </div>
      <p className="mt-2 line-clamp-2 text-[12.5px] font-semibold leading-tight text-white/90">
        {member.name}
      </p>
      {member.character && (
        <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-tight text-white/50">
          {member.character}
        </p>
      )}
    </div>
  );
}

export function Player({
  title,
  initialSeason,
  initialEpisode,
  seasons,
  episodePicked,
  artwork,
  similarCategory,
  similarGenre,
  cast,
}: {
  title: Title;
  initialSeason: number;
  initialEpisode: number;
  seasons: Season[];
  artwork?: { poster?: string; backdrop?: string };
  /** a URL já trouxe temporada+episódio (?s=&e=): deep link, próximo episódio — toca direto */
  episodePicked?: boolean;
  /** tudo26: "Mais como este" — id da categoria do painel (filmes) */
  similarCategory?: string;
  /** tudo26: "Mais como este" — id de gênero TMDB (séries) */
  similarGenre?: number;
  /** tudo26: "Elenco" — créditos do TMDB (foto, ator, personagem).
      Só vem no detalhe dos títulos do painel (details=true). */
  cast?: TmdbCastMember[];
}) {
  const router = useRouter();
  const { setProgress, progress, toast, settings, updateSettings } = useStore();
  const audio: AudioTrack = settings.animeAudio ?? "sub";

  const [mounted, setMounted] = useState(false);
  const anime = isAnimeTitle(title);
  /** título do painel (tmdbId 0 ou panel presente): player próprio, nunca embed */
  const isPanelTitle = title.tmdbId === 0 || Boolean(title.panel);
  /** painel: sem episódio explícito na URL, o usuário vê a visão de detalhe
     (capa, sinopse, temporada/episódio) ANTES de tocar — nada de S01E01
     automático e nenhum filme que começa sem mostrar a capa. Links com
     ?s=&e= (próximo episódio, deep link) tocam direto. */
  const needsPick = isPanelTitle && !episodePicked;
  const [picked, setPicked] = useState(() => !needsPick);
  /** gate de plano: /api/panel/me disse canWatch=false ou o stream deu 403 */
  const [planBlocked, setPlanBlocked] = useState<string | null>(null);
  /** sessão única (tudo20): outro aparelho entrou e esta sessão foi encerrada. */
  const [sessionEnded, setSessionEnded] = useState(false);
  /** motivo do stream do painel ter falhado (ex.: série sem episódios) */
  const [panelError, setPanelError] = useState<string | null>(null);
  const [panelRetry, setPanelRetry] = useState(0);
  const [anilistId, setAnilistId] = useState<number | null>(title.anilistId ?? null);
  /* anime servers need an AniList id — hold the frame until we have one */
  const [aniState, setAniState] = useState<"pending" | "ok" | "none">(() =>
    anime && !title.anilistId ? "pending" : "ok",
  );
  const [player, setPlayer] = useState<PlayerId>(() =>
    resolvePlayer(anime ? "vidnest" : DEFAULT_PLAYER, title),
  );
  /* embeds first — they are live right now, and a stale direct link used to
     leave the frame black. The CinePlus player is opt-in from the server menu. */
  const [nativeMode, setNativeMode] = useState(false);
  const [nativeState, setNativeState] = useState<"loading" | "ready" | "none">("loading");
  const [nativeSources, setNativeSources] = useState<NativeSource[]>([]);
  const [quality, setQuality] = useState<Quality>(DEFAULT_QUALITY);
  const [season, setSeason] = useState(initialSeason);
  const [episode, setEpisode] = useState(initialEpisode);

  /* Séries do painel: a página passa seasons=[] (não há TMDB aqui) — as
     temporadas/episódios vêm do get_series_info do painel, e sem elas o
     menu não mostrava nenhum seletor (sempre S01E01). */
  const [panelSeasons, setPanelSeasons] = useState<Season[]>([]);
  const [panelSeasonsLoaded, setPanelSeasonsLoaded] = useState(false);
  /* tudo20: metadados da série vindos do painel (capa, sinopse, gênero) —
     alimentam a visão de detalhe estilo Netflix antes de tocar. */
  const [panelMeta, setPanelMeta] = useState<{
    cover?: string;
    plot?: string;
    genre?: string;
    year?: number;
  }>({});
  useEffect(() => {
    if (!isPanelTitle || title.panel?.type !== "series" || title.kind !== "series") return;
    /* tudo27 (item 1): limpa os dados da série ANTERIOR antes de buscar os
       da nova — sem isso, a sinopse/gênero/temporadas velhas ficavam na
       tela até o fetch novo voltar (o bug "dados trocados"). A `key` no
       Player já remonta o componente, mas o reset aqui cobre qualquer
       reutilização sem key. */
    setPanelMeta({});
    setPanelSeasons([]);
    setPanelSeasonsLoaded(false);
    let alive = true;
    void fetchPanelInfo("series", title.panel.id).then((info) => {
      if (!alive) return;
      setPanelSeasonsLoaded(true);
      if (!info) return;
      /* metadados da série (get_series_info: info.cover / info.plot /
         info.genre / info.releaseDate) — capa e sinopse da visão de detalhe. */
      const meta = (info.info ?? {}) as Record<string, unknown>;
      const relYear = Number(String(meta.releaseDate ?? "").slice(0, 4)) || undefined;
      setPanelMeta({
        cover: typeof meta.cover === "string" && meta.cover ? meta.cover : undefined,
        plot: typeof meta.plot === "string" && meta.plot.trim() ? meta.plot.trim() : undefined,
        genre: typeof meta.genre === "string" && meta.genre.trim() ? meta.genre.trim() : undefined,
        year: relYear,
      });
      const raw = (info.episodes ?? {}) as Record<string, unknown>;
      const list: Season[] = Object.keys(raw)
        .map((key) => {
          const eps = Array.isArray(raw[key]) ? (raw[key] as Record<string, unknown>[]) : [];
          return {
            number: Number(key) || 0,
            year: title.year,
            episodes: eps
              .map((ep) => ({
                number: Number(ep.episode_num ?? 0) || 0,
                name:
                  String(ep.title ?? "").trim() ||
                  `Episódio ${Number(ep.episode_num ?? 0) || ""}`.trim(),
                runtime: Number(
                  (ep.info as Record<string, unknown> | undefined)?.duration ??
                    ep.duration ??
                    0,
                ) || 0,
                overview: String(ep.plot ?? ""),
              }))
              .filter((ep) => ep.number > 0)
              .sort((a, b) => a.number - b.number),
          };
        })
        .filter((s) => s.number > 0 && s.episodes.length > 0)
        .sort((a, b) => a.number - b.number);
      setPanelSeasons(list);
      /* tudo20: NÃO toca sozinho — a escolha acontece na visão de detalhe
         estilo Netflix (capa, sinopse, temporada, episódios) antes de tocar.
         Deep link com episódio explícito (?s=&e=) continua tocando direto
         (episodePicked=true, picked já começa true). */
    });
    return () => {
      alive = false;
    };
  }, [isPanelTitle, title, episodePicked]);

  /* tudo23: metadados do filme vindos do painel (get_vod_info: capa,
     sinopse, gênero, duração) — alimentam a visão de detalhe antes de
     tocar, igual à da série. */
  const [movieMeta, setMovieMeta] = useState<{
    cover?: string;
    plot?: string;
    genre?: string;
    duration?: number;
    year?: number;
  }>({});
  useEffect(() => {
    if (!isPanelTitle || title.panel?.type !== "movie" || title.kind !== "movie") return;
    /* tudo27 (item 1): limpa os dados do filme ANTERIOR antes de buscar os
       do novo — era o `movieMeta` velho (17 min, sinopse e gênero de
       Bressan) que ficava sob o título "Il corpo" até o get_vod_info novo
       voltar. */
    setMovieMeta({});
    let alive = true;
    void fetchPanelInfo("movie", title.panel.id).then((info) => {
      if (!alive || !info) return;
      const meta = (info.info ?? {}) as Record<string, unknown>;
      const movieData = (info.movie_data ?? {}) as Record<string, unknown>;
      const relYear = Number(String(meta.releaseDate ?? "").slice(0, 4)) || undefined;
      /* duração: o painel manda segundos (7200) ou "2:00:00" — vira minutos */
      const rawDur = meta.duration ?? movieData.duration;
      let duration: number | undefined;
      if (typeof rawDur === "number" && rawDur > 0) {
        duration = rawDur > 600 ? Math.round(rawDur / 60) : Math.round(rawDur);
      } else if (typeof rawDur === "string" && rawDur.includes(":")) {
        const parts = rawDur.split(":").map(Number);
        if (parts.length === 3 && parts.every(Number.isFinite)) {
          duration = parts[0] * 60 + parts[1];
        }
      }
      setMovieMeta({
        cover: typeof meta.cover === "string" && meta.cover ? meta.cover : undefined,
        plot: typeof meta.plot === "string" && meta.plot.trim() ? meta.plot.trim() : undefined,
        genre: typeof meta.genre === "string" && meta.genre.trim() ? meta.genre.trim() : undefined,
        duration,
        year: relYear,
      });
    });
    return () => {
      alive = false;
    };
  }, [isPanelTitle, title]);

  /* tudo27 (item 1): temporada/episódio/escolha resetam quando o título
     muda — sem isso, navegar de uma série para outra mantinha a temporada
     e o "já escolhi" do título anterior. (A `key` no Player já remonta o
     componente; isto cobre reutilização sem key.) */
  useEffect(() => {
    setSeason(initialSeason);
    setEpisode(initialEpisode);
    setPicked(!needsPick);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title.slug]);

  /* temporadas efetivas: as da página (TMDB/anime) ou as do painel */
  const allSeasons = seasons.length > 0 ? seasons : panelSeasons;

  /* tudo24: dados de exibição do TMDB para títulos do painel (details=true
     traz a duração) — capa, backdrop, sinopse, nota e gêneros por cima dos
     dados do painel, que viram fallback. Sem match, tudo continua do painel. */
  const tmdbDetail = useTmdbMeta(
    isPanelTitle
      ? {
          key: title.slug,
          title: title.name,
          year: title.year > 0 ? title.year : undefined,
          kind: title.kind === "series" ? "series" : "movie",
          details: true,
        }
      : null,
  );

  /* visão de detalhe (tudo20): sinopse/ano/gênero — do TMDB quando há,
     do painel quando não há, senão o que o título já traz; nunca inventa
     texto. A sinopse do TMDB (com cache) acaba com a intermitência do
     get_vod_info do painel, que às vezes vinha vazia. */
  const detailSynopsis =
    tmdbDetail?.overview ??
    panelMeta.plot ??
    movieMeta.plot ??
    (title.overview && !title.overview.includes("transmitindo do seu painel")
      ? title.overview
      : undefined);
  // tudo22: 0 = ano desconhecido (nunca mostra o ano atual como chute) —
  // o ano só aparece quando é o do painel ou o da URL, nunca 2026 piscando.
  const detailYear =
    panelMeta.year ?? movieMeta.year ?? tmdbDetail?.year ?? (title.year > 0 ? title.year : undefined);
  const detailGenre =
    (tmdbDetail && tmdbDetail.genres.length > 0 ? tmdbDetail.genres.join(" · ") : undefined) ??
    panelMeta.genre ??
    movieMeta.genre ??
    (title.genres?.length ? title.genres.join(" · ") : undefined);
  const detailDuration =
    tmdbDetail?.runtime ??
    movieMeta.duration ??
    (title.runtime && title.runtime > 0 ? title.runtime : undefined);
  /* tudo25: nota do TMDB — do hook do cliente ou do servidor (o
     title.rating já vem do TMDB resolvido na página); sem nota, não
     mostra ★. Nunca mais o 8 inventado. */
  const detailRating = tmdbDetail?.rating ?? (title.rating > 0 ? title.rating : undefined);
  /** capa da visão de detalhe e do poster do player: o artwork resolvido
     no servidor (TMDB) primeiro, depois o hook do cliente, depois o
     painel. tudo25: antes o artwork do servidor nem entrava aqui — a
     capa quebrada do painel vencia e o detalhe ficava preto. */
  const detailCover =
    artwork?.backdrop ??
    artwork?.poster ??
    tmdbDetail?.backdrop ??
    tmdbDetail?.poster ??
    panelMeta.cover ??
    movieMeta.cover;
  /** poster do player (backdrop grande como fundo enquanto carrega). */
  const playerPoster = detailCover
    ? apiUrl(`/api/img?u=${encodeURIComponent(detailCover)}`)
    : undefined;
  /** título limpo na exibição ([Lançamento] e "(AAAA)" fora). */
  const displayName = cleanTitle(title.name).title;

  /* tudo25: estágio 16:9 do player na própria tela do detalhe — igual à
     demonstração: a imagem grande com o botão de play já visível embaixo,
     sem ir para uma tela preta de "Conectando ao Painel…". O play nasce
     da imagem, visível de cara. */
  const playStage = (onPlay: () => void) => (
    <button
      type="button"
      onClick={onPlay}
      aria-label={`Assistir ${displayName}`}
      className="group relative mt-8 block w-full overflow-hidden rounded-2xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70"
    >
      <div className="relative aspect-video w-full overflow-hidden bg-gradient-to-br from-[#1a1033] via-[#0d1526] to-black">
        {detailCover && !coverBroken ? (
          <img
            src={apiUrl(`/api/img?u=${encodeURIComponent(detailCover)}`)}
            alt={displayName}
            onError={() => setCoverBroken(true)}
            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.02]"
          />
        ) : (
          <div className="grid h-full w-full place-items-center px-6">
            <span className="text-center text-base font-semibold text-white/70">{displayName}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/20" />
        <span className="absolute inset-0 grid place-items-center">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-[#e50914] shadow-[0_10px_36px_rgba(229,9,20,0.55)] transition group-hover:scale-110 group-active:scale-95 sm:h-20 sm:w-20">
            <PlayIcon width={28} height={28} className="ml-1 text-white" />
          </span>
        </span>
        <span className="absolute bottom-3 left-4 right-4 flex items-center gap-2 text-[13px] font-semibold text-white">
          <span className="truncate">{displayName}</span>
          {detailDuration ? <span className="shrink-0 text-white/60">{detailDuration} min</span> : null}
        </span>
      </div>
    </button>
  );

  /* Sessão única (tudo20): confere de 30 em 30s se esta sessão continua
     válida — se outro aparelho entrou, a sessão cai e o usuário vê a
     mensagem (em vez de o vídeo só parar de funcionar sem explicação). */
  useEffect(() => {
    if (!isPanelTitle) return;
    const id = window.setInterval(() => {
      void fetchPanelMe().then((me) => {
        if (me?.sessionEnded) setSessionEnded(true);
      });
    }, 30_000);
    return () => window.clearInterval(id);
  }, [isPanelTitle]);

  const [menu, setMenu] = useState(false);
  /* tudo17: painel de episódios visível (bottom sheet) — o seletor não vive
     mais só dentro do menu "Painel": ele abre sozinho ao abrir a série e tem
     botão próprio e claro no topo do player. */
  const [episodesOpen, setEpisodesOpen] = useState(false);
  /* tudo23: abas da visão de detalhe (Episódios / Saiba mais) e "Ler mais" da sinopse */
  const [detailTab, setDetailTab] = useState<"episodios" | "saiba">("episodios");
  const [synopsisExpanded, setSynopsisExpanded] = useState(false);
  /* tudo24: capa do detalhe quebrada (o proxy devolve 404 quando o host do
     painel está morto) — cai para o placeholder estilizado em vez de
     mostrar o texto alternativo cru sobre preto. */
  const [coverBroken, setCoverBroken] = useState(false);
  /* tudo25: reset também quando a capa muda — a capa quebrada do painel
     marcava coverBroken=true e a imagem boa do TMDB, que chegava depois,
     nunca era tentada. */
  useEffect(() => setCoverBroken(false), [title.slug, detailCover]);
  /* tudo26: pôster VERTICAL do detalhe (igual à demonstração: pôster à
     esquerda do título). É o poster do TMDB, não o backdrop. */
  const detailPoster =
    artwork?.poster ?? tmdbDetail?.poster ?? panelMeta.cover ?? movieMeta.cover;
  const [posterBroken, setPosterBroken] = useState(false);
  useEffect(() => setPosterBroken(false), [title.slug, detailPoster]);
  /* tudo26: duração do vídeo muito diferente da esperada = outro filme com
     o mesmo nome tocando (o painel pode ter o arquivo errado). Avisa uma
     vez por título, sem travar a reprodução. */
  const [durationMismatch, setDurationMismatch] = useState<{
    expectedMin: number;
    actualMin: number;
  } | null>(null);
  const mismatchChecked = useRef(false);
  useEffect(() => {
    mismatchChecked.current = false;
    setDurationMismatch(null);
  }, [title.slug]);
  /* tudo26: "Mais como este" — títulos do painel da mesma categoria/gênero
     (dados reais do painel, nunca inventados). */
  const [similar, setSimilar] = useState<CatalogueEntry[]>([]);
  useEffect(() => {
    if (!isPanelTitle || (!similarCategory && !similarGenre)) return;
    /* tudo27 (item 1): limpa o "Mais como este" do título anterior — sem
       isso, os cartões velhos ficavam até o catálogo novo voltar. */
    setSimilar([]);
    let alive = true;
    const params = new URLSearchParams({
      tab: title.kind === "series" ? "series" : "movie",
      limit: "12",
    });
    if (similarCategory) params.set("category", similarCategory);
    else if (similarGenre) params.set("genre", String(similarGenre));
    void fetch(apiUrl(`/api/catalogue?${params.toString()}`), { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!alive || !data) return;
        const list = (Array.isArray(data.results) ? data.results : []) as CatalogueEntry[];
        setSimilar(
          list.filter((e) => e.panel?.id !== title.panel?.id).slice(0, 12),
        );
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [isPanelTitle, similarCategory, similarGenre, title.kind, title.panel?.id]);
  /* temporada exibida no sheet (null = segue a temporada que está tocando) */
  const [sheetSeason, setSheetSeason] = useState<number | null>(null);
  const [chrome, setChrome] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [paused, setPaused] = useState(false);
  const [nudge, setNudge] = useState(false);
  const [upNext, setUpNext] = useState<{ left: number } | null>(null);
  const [nonce, setNonce] = useState(0);
  /* an embed that loads but never starts playing is invisible to us across
     origins — after a while we offer an explicit way out */
  const [stalled, setStalled] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);

  const iframeRef = useRef<HTMLIFrameElement>(null);
  const hideTimer = useRef<number | null>(null);
  const savedAt = useRef(0);
  const progressRef = useRef(progress);
  progressRef.current = progress;
  const loadedRef = useRef(false);
  const playingRef = useRef(false);
  const lastTime = useRef(0);
  const stillHits = useRef(0);
  const pauseTimer = useRef<number | null>(null);
  const nudgeTimer = useRef<number | null>(null);
  const nudgeHide = useRef<number | null>(null);
  const tried = useRef<Set<PlayerId>>(new Set());
  const fallbackUsed = useRef(false);
  const dismissed = useRef(false);

  const clearPauseTimer = () => {
    if (pauseTimer.current) window.clearTimeout(pauseTimer.current);
    pauseTimer.current = null;
  };

  /* anime servers speak AniList ids — resolve one when the title lacks it */
  useEffect(() => {
    if (!anime) {
      setAniState("ok");
      return;
    }
    if (title.anilistId) {
      setAnilistId(title.anilistId);
      setAniState("ok");
      return;
    }
    let alive = true;
    setAniState("pending");
    /* never hold the frame hostage to this lookup: after four seconds we fall
       back to the TMDB-id servers instead of showing an empty player */
    const patience = window.setTimeout(() => {
      if (alive) setAniState((current) => (current === "pending" ? "none" : current));
    }, 4000);
    void anilistIdFor({
      name: title.name,
      year: title.year,
      tmdbId: title.tmdbId,
      malId: title.malId,
    }).then((id) => {
      if (!alive) return;
      setAnilistId(id);
      setAniState(id ? "ok" : "none");
    });
    return () => {
      alive = false;
      window.clearTimeout(patience);
    };
  }, [anime, title.slug, title.name, title.year, title.tmdbId, title.anilistId, title.malId]);

  /* no AniList match at all: fall back to the TMDB servers rather than a blank frame */
  useEffect(() => {
    if (aniState !== "none") return;
    setPlayer((current) =>
      canPlay(current, title, null) && current !== "aniembed"
        ? current
        : resolvePlayer(DEFAULT_PLAYER, title, null),
    );
  }, [aniState, title]);

  /* our own player: resolve the real stream for this title/episode */
  useEffect(() => {
    /* sem episódio escolhido ainda (seletor de série do painel): não busca
       o stream — o vídeo só começa depois que o usuário escolhe. */
    if (!nativeMode || !picked) return;
    let alive = true;
    setNativeState("loading");
    setNativeSources([]);
    setPanelError(null);

    /* painel: o stream vem de /api/stream?panel=1 — sem plano ativo o
       servidor responde 403 plan-required e o gate de plano aparece */
    if (isPanelTitle && title.panel) {
      const params = new URLSearchParams({
        panel: "1",
        type: title.panel.type,
        id: String(title.panel.id),
      });
      if (title.panel.ext) params.set("ext", title.panel.ext);
      if (title.panel.type === "series") {
        params.set("season", String(season));
        params.set("episode", String(episode));
      }
      void fetch(apiUrl(`/api/stream?${params.toString()}`))
        .then(async (res) => {
          if (res.status === 403) {
            const data = (await res.json().catch(() => null)) as {
              reason?: string;
            } | null;
            // Sessão única (tudo20): outro aparelho entrou — não é falta de
            // plano, é sessão encerrada: mostra a mensagem e volta ao login.
            if (alive && data?.reason === "session-ended") {
              setSessionEnded(true);
            } else if (alive && data?.reason === "plan-required") {
              setPlanBlocked(
                "Este conteúdo precisa de um plano ativo. Ative um plano para assistir.",
              );
            }
            return null;
          }
          return res.ok ? res.json() : null;
        })
        .then((data: { ok?: boolean; reason?: string; sources?: Array<Record<string, unknown>> } | null) => {
          if (!alive || !data) return;
          /* normaliza o que o painel devolve para o NativeSource: o painel
             marca live como type "m3u8" e o player espera "hls" | "mp4" */
          const sources: NativeSource[] = (data.sources ?? [])
            .filter(
              (entry): entry is Record<string, unknown> =>
                Boolean(entry) && typeof entry === "object",
            )
            .map((entry) => ({
              url: String(entry.url ?? ""),
              proxy: typeof entry.proxy === "string" ? entry.proxy : undefined,
              type: entry.type === "mp4" ? ("mp4" as const) : ("hls" as const),
              quality: typeof entry.quality === "string" ? entry.quality : undefined,
              label: typeof entry.label === "string" ? entry.label : "Painel",
            }))
            .filter((entry) => entry.url.length > 0);
          if (data?.ok && sources.length) {
            setNativeSources(sources);
            setNativeState("ready");
          } else {
            /* mostra o motivo de verdade, não um erro genérico */
            if (data?.reason === "no-episodes") {
              setPanelError("Esta série ainda não tem episódios no painel.");
            } else if (data?.reason === "panel-unavailable") {
              setPanelError("O painel não respondeu agora — tente novamente em alguns instantes.");
            } else if (data?.reason === "plan-required") {
              setPanelError("Este conteúdo precisa de um plano ativo.");
            } else {
              setPanelError("O painel não devolveu um stream para este título agora.");
            }
            setNativeState("none");
          }
        })
        .catch(() => {
          if (alive) setNativeState("none");
        });
      return () => {
        alive = false;
      };
    }

    const tmdbId = title.tmdbId;
    if (!tmdbId) {
      setNativeState("none");
      return;
    }

    const params = new URLSearchParams({
      tmdb: String(tmdbId),
      kind: title.kind === "series" ? "series" : "movie",
      season: String(season),
      episode: String(episode),
    });

    void fetch(apiUrl(`/api/stream?${params.toString()}`))
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { ok?: boolean; sources?: NativeSource[] } | null) => {
        if (!alive) return;
        const sources = data?.sources ?? [];
        if (data?.ok && sources.length) {
          setNativeSources(sources);
          setNativeState("ready");
        } else {
          setNativeState("none");
        }
      })
      .catch(() => {
        if (alive) setNativeState("none");
      });

    return () => {
      alive = false;
    };
  }, [nativeMode, picked, title.tmdbId, title.kind, title.panel, isPanelTitle, season, episode, panelRetry]);

  /* restore the user's chosen source + quality (default: frameXTV) */
  useEffect(() => {
    setMounted(true);
    const stored = ls.get("nf.player");
    const preferred = isPlayerId(stored) ? stored : DEFAULT_PLAYER;
    /* anime never starts on a TMDB-only server; films/series keep the user's pick */
    const start = anime && !metaOf(preferred).animeOnly ? "vidnest" : preferred;
    setPlayer(resolvePlayer(start, title, title.anilistId ?? null));
    const q = ls.get("nf.quality");
    if (q && (QUALITIES as readonly string[]).includes(q)) setQuality(q as Quality);
    /* only an explicit opt-in turns the CinePlus player back on — except
       títulos do painel, que SEMPRE usam o player próprio, nunca o embed */
    try {
      setNativeMode(isPanelTitle || window.localStorage.getItem("nf.native3") === "1");
    } catch {
      /* private mode — stay on the embeds (panel titles excepted above) */
      setNativeMode(isPanelTitle);
    }
    // legacy keys are deliberately ignored so everyone lands on frameXTV
  }, [title]);

  /* gate de plano para títulos do painel: só bloqueia quando /api/panel/me
     responde canWatch=false. Sem resposta (rota ainda inexistente, rede
     fora), não bloqueia — o stream 403 continua sendo o guarda final. */
  useEffect(() => {
    if (!isPanelTitle) return;
    let alive = true;
    void fetchPanelMe().then((me) => {
      if (!alive || !me) return;
      if (!me.canWatch) {
        setPlanBlocked(
          "Este conteúdo precisa de um plano ativo. Ative um plano para assistir.",
        );
      }
    });
    return () => {
      alive = false;
    };
  }, [isPanelTitle]);

  /**
   * The embed URL depends only on [source, quality, episode] — playback
   * telemetry is read through refs, so a tick can never remount the frame
   * (that was the old endless-reconnect bug).
   */
  const src = useMemo(() => {
    const stored = progressRef.current[title.slug];
    const sameEpisode = stored && stored.season === season && stored.episode === episode;
    const resumeAt =
      sameEpisode && stored.percent > 0.02 && stored.percent < 0.95 && stored.seconds
        ? stored.seconds
        : null;
    return buildSrc({
      player,
      title,
      season,
      episode,
      quality,
      resumeAt,
      anilistId,
      audio,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    player,
    quality,
    title.tmdbId,
    title.anilistId,
    title.kind,
    season,
    episode,
    nonce,
    anilistId,
    audio,
  ]);

  /* títulos do painel não têm "Mais como este" do TMDB: sem sugestões */
  const suggestions = useMemo(
    () => (isPanelTitle ? [] : moreLikeThis(title, progress, 6)),
    [isPanelTitle, title, progress],
  );

  /* servers in this title's own failover order */
  const orderedPlayers = useMemo(
    () => playOrder(title).map((id) => PLAYERS.find((entry) => entry.id === id)).filter(Boolean) as typeof PLAYERS,
    [title],
  );
  const nextEp = useMemo(() => nextEpisodeOf(allSeasons, season, episode), [allSeasons, season, episode]);
  const nextEpisodeLabel = useMemo(() => {
    if (!nextEp) return undefined;
    const name = allSeasons
      .find((entry) => entry.number === nextEp.season)
      ?.episodes.find((item) => item.number === nextEp.episode)?.name;
    return name ? `S${nextEp.season} E${nextEp.episode} · ${name}` : `S${nextEp.season} E${nextEp.episode}`;
  }, [nextEp, allSeasons]);
  /** where our own player should start (same rule the embeds use) */
  const startAt = useMemo(() => {
    const stored = progress[title.slug];
    const sameEpisode = stored && stored.season === season && stored.episode === episode;
    return sameEpisode && stored.percent > 0.02 && stored.percent < 0.95 && stored.seconds
      ? stored.seconds
      : null;
  }, [progress, title.slug, season, episode]);
  /* our player is the default; a title with no resolvable stream falls back */
  const nativeActive = nativeMode && nativeState !== "none";
  const currentSeason = allSeasons.find((s) => s.number === season);
  /** temporada exibida no seletor (cai para a primeira quando a atual não existe) */
  const pickerSeason = currentSeason ?? allSeasons[0];
  /** temporada exibida no sheet de episódios (tudo17) */
  const sheetSeasonData =
    allSeasons.find((s) => s.number === (sheetSeason ?? season)) ?? allSeasons[0];

  /* tudo20: o sheet NÃO abre sozinho — a escolha principal acontece na
     visão de detalhe, antes de tocar. Durante a reprodução ele abre só pelo
     botão "Episódios" do topo (e fecha com ESC/X). */

  /* ---------------------------------------------------------------- source */

  /**
   * Walk this title's chain: each server at most once, and only when a frame
   * genuinely fails to load. Playback telemetry is not a liveness signal —
   * most embeds never postMessage, so treating "no data" as failure used to
   * bounce a perfectly good stream through every provider in the list.
   */
  const hardFallback = useCallback(() => {
    /* tudo26: títulos do painel NUNCA usam embed — o timer de 12s do
       iframe (que nunca renderiza aqui) disparava o hardFallback e os
       avisos "O frameXTV não respondeu — tentando VidLink…" pipocavam
       durante a reprodução do painel, sem motivo. */
    if (isPanelTitle) return false;
    const candidate = playOrder(title).find(
      (id) => id !== player && canPlay(id, title, anilistId) && !tried.current.has(id),
    );
    if (!candidate) return false;
    tried.current.add(player);
    fallbackUsed.current = true;
    setPlayer(candidate);
    toast(`O ${playerMeta(player).label} não respondeu — tentando ${playerMeta(candidate).label}`);
    return true;
  }, [player, title, toast, anilistId, isPanelTitle]);

  /** Manual "next server": ignores the tried set so it always does something. */
  const cycleServer = useCallback(() => {
    /* tudo26: títulos do painel só têm o servidor do painel. */
    if (isPanelTitle) return;
    const chain = playOrder(title).filter((id) => canPlay(id, title, anilistId));
    if (chain.length < 2) {
      toast("Esta é a única fonte para este título");
      return;
    }
    const next = chain[(chain.indexOf(player) + 1) % chain.length];
    tried.current.clear();
    setPlayer(next);
    setMenu(false);
    toast(`Tocando de ${playerMeta(next).label}`);
  }, [player, title, toast, anilistId, isPanelTitle]);

  /** the server the "try another" button will switch to */
  const nextUp = useMemo(() => {
    const chain = playOrder(title).filter((id) => canPlay(id, title, anilistId));
    if (chain.length < 2) return null;
    return chain[(chain.indexOf(player) + 1) % chain.length];
  }, [title, player, anilistId]);

  useEffect(() => {
    /* tudo26: títulos do painel não têm "outro servidor" para sugerir. */
    if (nativeActive || isPanelTitle) {
      setStalled(false);
      return;
    }
    setStalled(false);
    const timer = window.setTimeout(() => {
      /* only when nothing has reported playback — a silent provider is not a
         dead one, so this prompts rather than switching by itself */
      if (!playingRef.current) setStalled(true);
    }, 12000);
    return () => window.clearTimeout(timer);
  }, [src, nativeActive, playing, isPanelTitle]);

  /* per-source reset: cheap, so switching feels instant */
  useEffect(() => {
    setLoaded(false);
    setPlaying(false);
    setPaused(false);
    setNudge(false);
    setUpNext(null);
    dismissed.current = false;
    loadedRef.current = false;
    playingRef.current = false;
    lastTime.current = 0;
    stillHits.current = 0;
    clearPauseTimer();

    /* a frame that never even loads is the only failure we can see across
       origins — give embeds 12s before moving on by ourselves.
       tudo26: títulos do painel (e o player próprio ativo) NUNCA renderizam
       o iframe — sem o guarda, o timer disparava o hardFallback a cada 12s
       e os avisos de embed falhando pipocavam durante o filme do painel. */
    if (isPanelTitle || nativeActive) return;
    const slow = window.setTimeout(() => {
      if (!loadedRef.current) hardFallback();
    }, 12000);
    return () => window.clearTimeout(slow);
  }, [src, hardFallback, isPanelTitle, nativeActive]);

  /* ------------------------------------------------------------- telemetry */

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || typeof data !== "object") return;

      if ((data as { type?: string }).type === "CINELITE_EXIT_PLAYER") {
        router.back();
        return;
      }

      const tick = readTick(data);
      if (!tick) return;

      const { current, total } = tick;

      if (!loadedRef.current) {
        loadedRef.current = true;
        setLoaded(true);
      }
      if (!playingRef.current && current > 0.5) {
        playingRef.current = true;
        setPlaying(true);
        setNudge(false);
      }

      /* pause = a tick whose clock didn't move (providers tick ~3.5s) */
      const delta = current - lastTime.current;
      lastTime.current = current;
      if (delta > 0.4) {
        stillHits.current = 0;
        clearPauseTimer();
        setPaused(false);
      } else if (current > 5) {
        clearPauseTimer();
        pauseTimer.current = window.setTimeout(() => {
          stillHits.current += 1;
          setPaused(true);
          setShowSuggestions(true);
        }, 1200);
      }

      /* up-next: fires once, near the end of an episode */
      const ratio = total > 0 ? current / total : 0;
      if (tick.completed || ratio >= 0.93) {
        if (!dismissed.current && nextEp) {
          setUpNext((prev) => prev ?? { left: 12 });
        }
      }

      const now = Date.now();
      if (now - savedAt.current > 5000 || tick.completed) {
        savedAt.current = now;
        setProgress(title.slug, {
          season: title.kind === "series" ? (tick.season ?? season) : 1,
          episode: title.kind === "series" ? (tick.episode ?? episode) : 1,
          percent: tick.completed ? 1 : Math.min(1, Math.max(0, ratio)),
          seconds: current,
          duration: total,
          updated: now,
          /* tudo26: metadados para a fileira "Continuar assistindo" — sem
             eles, a fileira não sabe nem o nome do título que parou. */
          name: displayName,
          kind: title.kind,
          panelType: title.panel?.type,
          panelId: title.panel?.id,
          year: title.year > 0 ? title.year : undefined,
        });
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [router, setProgress, title.slug, title.kind, season, episode, nextEp]);

  /* ----------------------------------------------------------- up next flow */

  const goTo = useCallback(
    (s: number, e: number) => {
      setUpNext(null);
      dismissed.current = false;
      setSeason(s);
      setEpisode(e);
      setMenu(false);
      if (typeof window !== "undefined") {
        window.history.replaceState(null, "", appUrl(`/watch/series/${title.slug}?s=${s}&e=${e}`));
      }
    },
    [title.slug],
  );

  /** escolha no seletor (antes de tocar): vai para o episódio e libera o play */
  const pickEpisode = useCallback(
    (s: number, e: number) => {
      goTo(s, e);
      setPicked(true);
    },
    [goTo],
  );

  useEffect(() => {
    if (!upNext) return;
    if (upNext.left <= 0) {
      if (nextEp) goTo(nextEp.season, nextEp.episode);
      return;
    }
    const timer = window.setTimeout(
      () => setUpNext((current) => (current ? { left: current.left - 1 } : current)),
      1000,
    );
    return () => window.clearTimeout(timer);
  }, [upNext, nextEp, goTo]);

  /* ---------------------------------------------------------------- chrome */

  const poke = useCallback(() => {
    setChrome(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setChrome(false), 3000);
  }, []);

  useEffect(() => {
    poke();
    const onMove = () => poke();
    window.addEventListener("mousemove", onMove);
    window.addEventListener("touchstart", onMove, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("touchstart", onMove);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [poke]);

  useEffect(() => {
    if (menu || episodesOpen) {
      setChrome(true);
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    } else {
      poke();
    }
  }, [menu, episodesOpen, poke]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const el = event.target as HTMLElement | null;
      if (el && ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName)) return;
      if (event.key === "Escape") {
        if (episodesOpen) setEpisodesOpen(false);
        else if (menu) setMenu(false);
        else router.back();
        return;
      }
      if (event.key.toLowerCase() === "n" && nextEp) goTo(nextEp.season, nextEp.episode);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menu, episodesOpen, router, nextEp, goTo]);

  /* --------------------------------------------------------------- actions */

  const canPlayNow = (id: PlayerId) => resolvePlayer(id, title, anilistId) === id;

  const changePlayer = (next: PlayerId) => {
    if (!canPlayNow(next)) {
      toast(`O ${playerMeta(next).label} não tem stream para este título`);
      return;
    }
    tried.current.clear();
    setPlayer(next);
    setNativeMode(false);
    localStorage.setItem("nf.native3", "0");
    ls.set("nf.player", next);
    toast(`Tocando de ${playerMeta(next).label}`);
    setMenu(false);
  };

  const changeQuality = (next: Quality) => {
    setQuality(next);
    ls.set("nf.quality", next);
    toast(`Reiniciando em ${next.toUpperCase()}`);
    setMenu(false);
  };

  const restart = () => {
    setNudge(false);
    setNonce((n) => n + 1);
  };

  /* tudo26: o vídeo é outro filme — busca o título certo no painel (o
     título do TMDB que o detalhe mostra) e abre o primeiro com id
     diferente do atual. Sem match, avisa em vez de trocar no escuro. */
  const [findingCorrect, setFindingCorrect] = useState(false);
  const findCorrectTitle = useCallback(async () => {
    const wanted = (tmdbDetail?.title ?? displayName).trim();
    if (!wanted || findingCorrect) return;
    setFindingCorrect(true);
    try {
      const res = await fetch(
        apiUrl(
          `/api/catalogue?tab=${title.kind === "series" ? "series" : "movie"}&q=${encodeURIComponent(wanted)}&limit=10`,
        ),
        { cache: "no-store" },
      );
      const data = (await res.json().catch(() => null)) as {
        results?: CatalogueEntry[];
      } | null;
      const list = Array.isArray(data?.results) ? data.results : [];
      const other = list.find((e) => e.panel?.id !== title.panel?.id);
      if (other?.panel) {
        const cleaned = cleanTitle(other.name);
        const y = other.year ?? cleaned.year;
        router.push(
          appUrl(
            `/play/0?panel=1&type=${other.panel.type}&id=${other.panel.id}&title=${encodeURIComponent(cleaned.title)}${y ? `&year=${y}` : ""}`,
          ),
        );
        setDurationMismatch(null);
      } else {
        toast("Não achei outro título com esse nome no painel");
      }
    } catch {
      toast("Não consegui buscar no painel agora");
    } finally {
      setFindingCorrect(false);
    }
  }, [tmdbDetail?.title, displayName, title.kind, title.panel?.id, findingCorrect, router, toast]);

  const showChrome = chrome || menu || Boolean(upNext);
  const showRail = paused && playing && !upNext && showSuggestions && suggestions.length > 0;
  const activePlayer = playerMeta(player);

  return (
    <div className="fixed inset-0 overflow-hidden bg-black text-white">
      {/* warm the connection to whichever embed is next */}
      <link rel="preconnect" href="https://framextv.cc" crossOrigin="" />
      <link rel="dns-prefetch" href="https://framextv.cc" />
      <link rel="preconnect" href="https://embed.cinelite.xyz" crossOrigin="" />
      <link rel="dns-prefetch" href="https://embed.cinelite.xyz" />
      <link rel="preconnect" href="https://vidfast.pro" crossOrigin="" />
      <link rel="dns-prefetch" href="https://vidfast.pro" />
      <link rel="preconnect" href="https://vidlink.pro" crossOrigin="" />
      <link rel="dns-prefetch" href="https://vidlink.pro" />

      {/* poster behind the frame: never a black flash while it boots */}
      <div className="absolute inset-0">
        <Artwork
          slug={title.slug}
          name={title.name}
          kind="backdrop"
          accent={title.accent}
          priority
          sizes="100vw"
        />
        <div className="absolute inset-0 bg-black/80" />
      </div>

      {/* gate de plano: no lugar do player, CTA para /planos */}
      {planBlocked && <PlanGate reason={planBlocked} />}

      {/* sessão única (tudo20): outro aparelho entrou e esta sessão foi
          encerrada — mostra o motivo e volta ao login. */}
      {sessionEnded && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-black px-6 text-center">
          <div className="max-w-md">
            <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#e50914]">
              Você está assistindo · CinePlus
            </p>
            <h2 className="mt-3 text-2xl font-bold text-white md:text-3xl">
              Sua sessão foi encerrada
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-white/60">
              Você entrou em outro aparelho, então esta sessão foi encerrada.
              Entre novamente para continuar assistindo.
            </p>
            <button
              type="button"
              onClick={() => router.push(appUrl("/login?session=ended"))}
              className="mt-6 rounded-md btn-neon px-6 py-3 text-sm font-bold transition"
            >
              Entrar novamente
            </button>
          </div>
        </div>
      )}

      {/* tudo20: visão de detalhe estilo Netflix — capa, sinopse, temporada
          e episódios ANTES de tocar. Substitui a antiga tela "Escolher episódio"
          (que era só o seletor, sem capa nem sinopse). O vídeo só carrega
          depois que o usuário escolhe um episódio. Não é um popup por cima
          do vídeo. */}
      {!picked && !planBlocked && (
        <div className="absolute inset-0 z-40 overflow-y-auto bg-black">
          {/* Hero: capa/backdrop da série */}
          <div className="relative h-[42vh] min-h-[260px] w-full overflow-hidden sm:h-[54vh]">
            {detailCover && !coverBroken ? (
              <img
                src={apiUrl(`/api/img?u=${encodeURIComponent(detailCover)}`)}
                alt={displayName}
                onError={() => setCoverBroken(true)}
                className="h-full w-full object-cover"
              />
            ) : (
              /* tudo24: sem imagem em lugar nenhum — placeholder estilizado
                 com o título, nunca o texto alternativo cru sobre preto. */
              <div className="grid h-full w-full place-items-center bg-gradient-to-br from-[#1a1033] via-[#0d1526] to-black px-6">
                <div className="text-center">
                  {/* tudo25: sem letra/número gigante — era a primeira letra
                      do título ("1" em 18 Rosas, "0" em GoldenEye) parecendo
                      o numeral do Top 10 vazando para o detalhe. */}
                  <span className="mx-auto grid h-16 w-16 place-items-center rounded-full border border-white/15 bg-white/[0.06]">
                    <PlayIcon width={24} height={24} className="ml-0.5 text-white/70" />
                  </span>
                  <span className="mt-3 block text-lg font-semibold text-white/70">
                    {displayName}
                  </span>
                </div>
              </div>
            )}
            <div className="absolute inset-0 bg-gradient-to-t from-black via-black/30 to-transparent" />
            <div className="absolute inset-0 bg-gradient-to-r from-black/50 via-transparent to-transparent" />
            <button
              type="button"
              onClick={() => router.back()}
              aria-label="Voltar"
              className="absolute left-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-black/60 text-white backdrop-blur-md transition hover:bg-black/80 md:left-6 md:top-5"
            >
              <ArrowLeftIcon width={18} height={18} />
            </button>
          </div>

          {/* Conteúdo */}
          <div className="relative mx-auto -mt-20 w-full max-w-[880px] px-4 pb-12 sm:-mt-24 md:px-6">
            {/* tudo26: pôster vertical à esquerda do título, igual à demonstração */}
            <div className="flex gap-4 md:gap-6">
              {detailPoster && !posterBroken ? (
                <div className="w-[104px] shrink-0 sm:w-[130px] md:w-[160px]">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={apiUrl(`/api/img?u=${encodeURIComponent(detailPoster)}`)}
                    alt={displayName}
                    onError={() => setPosterBroken(true)}
                    className="aspect-[2/3] w-full rounded-lg object-cover ring-1 ring-white/10"
                  />
                </div>
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-[#e50914]">
                  {title.kind === "series" ? "Série" : "Filme"}
                </p>
                <h1 className="mt-1 text-3xl font-bold leading-tight text-white md:text-[40px] md:leading-[1.1]">
                  {displayName}
                </h1>
                <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-white/60">
                  {detailYear ? <span>{detailYear}</span> : null}
                  {detailRating ? (
                    <span className="flex items-center gap-1 font-semibold text-white">
                      <span className="text-[#ffc107]">★</span>
                      {detailRating.toFixed(1)}
                    </span>
                  ) : null}
                  {detailGenre ? <span>{detailGenre}</span> : null}
                  {detailDuration ? <span>{detailDuration} min</span> : null}
                  {title.kind === "series" && allSeasons.length > 0 && (
                    <span>
                      {allSeasons.length} {allSeasons.length === 1 ? "temporada" : "temporadas"}
                    </span>
                  )}
                </p>
                {detailSynopsis ? (
                  <div className="mt-3 max-w-[640px]">
                    <p
                      className={cn(
                        "text-[14px] leading-relaxed text-white/75",
                        !synopsisExpanded && "line-clamp-2",
                      )}
                    >
                      {detailSynopsis}
                    </p>
                    {detailSynopsis.length > 180 && (
                      <button
                        type="button"
                        onClick={() => setSynopsisExpanded((v) => !v)}
                        className="mt-1 text-[13px] font-semibold text-white/90 underline-offset-2 hover:underline"
                      >
                        {synopsisExpanded ? "Ler menos" : "Ler mais"}
                      </button>
                    )}
                  </div>
                ) : null}
              </div>
            </div>

            {title.kind === "movie" ? (
              /* filme: CTA vermelho em pílula + estágio 16:9 com a imagem
                 grande e o play já visível embaixo (igual à demonstração) */
              <>
                <button
                  type="button"
                  onClick={() => setPicked(true)}
                  className="mt-6 flex items-center gap-2.5 rounded-full bg-[#e50914] px-6 py-3 text-[14px] font-bold text-white shadow-[0_8px_30px_rgba(229,9,20,0.45)] transition hover:bg-[#f6121f] active:scale-[0.98]"
                >
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-white">
                    <PlayIcon width={12} height={12} className="text-[#e50914]" />
                  </span>
                  Assistir Agora
                </button>
                {playStage(() => setPicked(true))}
              </>
            ) : allSeasons.length === 0 ? (
              panelSeasonsLoaded ? (
                <div className="mt-8">
                  <p className="text-[13px] text-white/55">
                    O painel não devolveu a lista de episódios desta série.
                  </p>
                  <button
                    type="button"
                    onClick={() => pickEpisode(1, 1)}
                    className="mt-4 flex items-center gap-2.5 rounded-full bg-[#e50914] px-6 py-3 text-[14px] font-bold text-white shadow-[0_8px_30px_rgba(229,9,20,0.45)] transition hover:bg-[#f6121f] active:scale-[0.98]"
                  >
                    <span className="grid h-6 w-6 place-items-center rounded-full bg-white">
                      <PlayIcon width={12} height={12} className="text-[#e50914]" />
                    </span>
                    Assistir Agora
                  </button>
                  {playStage(() => pickEpisode(1, 1))}
                </div>
              ) : (
                <div className="mt-8 flex items-center gap-2.5">
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/25 border-t-[var(--nf-accent)]" />
                  <p className="text-[13px] font-medium text-white/55">
                    Carregando temporadas e episódios…
                  </p>
                </div>
              )
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => {
                    const first = pickerSeason?.episodes[0];
                    if (pickerSeason && first) pickEpisode(pickerSeason.number, first.number);
                  }}
                  className="mt-6 flex items-center gap-2.5 rounded-full bg-[#e50914] px-6 py-3 text-[14px] font-bold text-white shadow-[0_8px_30px_rgba(229,9,20,0.45)] transition hover:bg-[#f6121f] active:scale-[0.98]"
                >
                  <span className="grid h-6 w-6 place-items-center rounded-full bg-white">
                    <PlayIcon width={12} height={12} className="text-[#e50914]" />
                  </span>
                  Assistir Agora
                </button>

                {playStage(() => {
                  const first = pickerSeason?.episodes[0];
                  if (pickerSeason && first) pickEpisode(pickerSeason.number, first.number);
                })}

                {/* abas: só as que têm conteúdo real (sem inventar elenco) */}
                <div className="mt-8 flex gap-6 border-b border-white/10">
                  <button
                    type="button"
                    onClick={() => setDetailTab("episodios")}
                    aria-pressed={detailTab === "episodios"}
                    className={cn(
                      "-mb-px border-b-2 pb-2.5 text-[14px] font-bold transition",
                      detailTab === "episodios"
                        ? "border-[#e50914] text-white"
                        : "border-transparent text-white/45 hover:text-white/75",
                    )}
                  >
                    Episódios
                  </button>
                  <button
                    type="button"
                    onClick={() => setDetailTab("saiba")}
                    aria-pressed={detailTab === "saiba"}
                    className={cn(
                      "-mb-px border-b-2 pb-2.5 text-[14px] font-bold transition",
                      detailTab === "saiba"
                        ? "border-[#e50914] text-white"
                        : "border-transparent text-white/45 hover:text-white/75",
                    )}
                  >
                    Saiba mais
                  </button>
                </div>

                {detailTab === "episodios" ? (
                  <>
                    {allSeasons.length > 1 && (
                      <div className="mt-5 flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                        {allSeasons.map((entry) => (
                          <button
                            key={entry.number}
                            type="button"
                            onClick={() => setSeason(entry.number)}
                            aria-pressed={entry.number === pickerSeason?.number}
                            className={
                              entry.number === pickerSeason?.number
                                ? "shrink-0 rounded-full bg-white px-4 py-2 text-[13px] font-bold text-black"
                                : "shrink-0 rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-[13px] font-medium text-white/60 transition hover:border-white/40 hover:text-white"
                            }
                          >
                            {entry.name && !/^Season \d+$/.test(entry.name)
                              ? entry.name
                              : `Temporada ${entry.number}`}
                          </button>
                        ))}
                      </div>
                    )}
                    <p className="mt-5 text-[12px] font-semibold uppercase tracking-[0.16em] text-white/40">
                      {pickerSeason?.name && !/^Season \d+$/.test(pickerSeason.name)
                        ? pickerSeason.name
                        : `Temporada ${pickerSeason?.number ?? season}`}
                      {allSeasons.length > 1 ? ` · ${allSeasons.length} temporadas` : ""}
                    </p>
                    <div className="mt-1">
                      {(pickerSeason?.episodes ?? []).map((item) => (
                        <EpisodeRow
                          key={item.number}
                          number={item.number}
                          name={item.name}
                          runtime={item.runtime}
                          overview={item.overview}
                          onClick={() => pickEpisode(pickerSeason?.number ?? season, item.number)}
                        />
                      ))}
                    </div>
                  </>
                ) : (
                  <div className="mt-5 max-w-[640px]">
                    {detailSynopsis ? (
                      <p className="text-[14px] leading-relaxed text-white/75">{detailSynopsis}</p>
                    ) : (
                      <p className="text-[13px] text-white/55">Sem sinopse no painel.</p>
                    )}
                    <dl className="mt-5 space-y-2 text-[13px]">
                      {detailYear ? (
                        <div className="flex gap-3">
                          <dt className="w-24 shrink-0 text-white/40">Ano</dt>
                          <dd className="text-white/85">{detailYear}</dd>
                        </div>
                      ) : null}
                      {detailGenre ? (
                        <div className="flex gap-3">
                          <dt className="w-24 shrink-0 text-white/40">Gêneros</dt>
                          <dd className="text-white/85">{detailGenre}</dd>
                        </div>
                      ) : null}
                      <div className="flex gap-3">
                        <dt className="w-24 shrink-0 text-white/40">Temporadas</dt>
                        <dd className="text-white/85">{allSeasons.length}</dd>
                      </div>
                      <div className="flex gap-3">
                        <dt className="w-24 shrink-0 text-white/40">Episódios</dt>
                        <dd className="text-white/85">
                          {allSeasons.reduce((n, entry) => n + entry.episodes.length, 0)}
                        </dd>
                      </div>
                    </dl>
                  </div>
                )}
              </>
            )}
            {/* tudo26: "Elenco" — créditos do TMDB (foto, ator, personagem).
                Só aparece quando o TMDB devolve elenco; sem inventar.
                tudo27 (item 2): o `cast` do servidor primeiro; se ele vier
                vazio, usa o do hook do cliente (segunda chance — o resolve
                do cliente pode ter conseguido o credits quando o do servidor
                falhou). Enquanto nenhum dos dois resolveu, mostra um
                esqueleto "Carregando elenco…" em vez de sumir: antes, a
                seção só existia quando o cast já vinha pronto, e um credits
                lento parecia "sem elenco". */}
            {(() => {
              const displayCast =
                cast && cast.length > 0 ? cast : tmdbDetail?.cast;
              const castLoading =
                isPanelTitle && !displayCast && tmdbDetail === undefined;
              if (displayCast && displayCast.length > 0) {
                return (
                  <section className="mt-10">
                    <h2 className="text-[15px] font-semibold tracking-wide text-[#e5e5e5] md:text-[19px]">
                      Elenco
                    </h2>
                    <div className="mt-3 flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      {displayCast.map((member) => (
                        <CastMember key={member.name} member={member} />
                      ))}
                    </div>
                  </section>
                );
              }
              if (castLoading) {
                return (
                  <section className="mt-10">
                    <h2 className="text-[15px] font-semibold tracking-wide text-[#e5e5e5] md:text-[19px]">
                      Elenco
                    </h2>
                    <div className="mt-3 flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                      {[0, 1, 2, 3, 4].map((i) => (
                        <div key={i} className="w-[88px] shrink-0 text-center">
                          <div className="mx-auto h-16 w-16 animate-pulse rounded-full bg-white/10" />
                          <div className="mx-auto mt-2 h-3 w-14 animate-pulse rounded bg-white/10" />
                          <div className="mx-auto mt-1 h-2.5 w-10 animate-pulse rounded bg-white/10" />
                        </div>
                      ))}
                    </div>
                  </section>
                );
              }
              return null;
            })()}
            {/* tudo26: "Mais como este" — títulos reais do painel, da mesma
                categoria/gênero. Só aparece quando há pelo menos 3. */}
            {similar.length >= 3 && (
              <section className="mt-10">
                <h2 className="text-[15px] font-semibold tracking-wide text-[#e5e5e5] md:text-[19px]">
                  Mais como este
                </h2>
                <div className="mt-3 flex gap-3 overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                  {similar.map((entry) => (
                    <div key={entry.key} className="shrink-0 snap-start">
                      <PanelPosterCard entry={entry} />
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>
      )}

      {/* painel sem stream resolvido (e sem bloqueio de plano): tentar de novo */}
      {!planBlocked && isPanelTitle && nativeMode && nativeState === "none" && (
        <div className="absolute inset-0 z-40 grid place-items-center bg-black/85 px-6 text-center">
          <div>
            <p className="text-[15px] font-semibold">Este conteúdo não começou no player</p>
            <p className="mt-1 text-[12.5px] text-white/55">
              {panelError ?? "O painel não devolveu um stream para este título agora."}
            </p>
            <button
              type="button"
              onClick={() => {
                setNativeState("loading");
                setPanelError(null);
                setPanelRetry((n) => n + 1);
              }}
              className="mt-4 rounded-full bg-white px-4 py-2 text-[12.5px] font-semibold text-black"
            >
              Tentar novamente
            </button>
          </div>
        </div>
      )}

      {nativeActive && nativeState === "loading" && (
        <div className="absolute inset-0 overflow-hidden">
          {/* tudo25: a imagem grande do filme atrás do spinner — o player
              nasce da imagem, nunca de uma tela preta. */}
          {playerPoster ? (
            <img src={playerPoster} alt="" aria-hidden className="h-full w-full object-cover" />
          ) : null}
          <div className="absolute inset-0 bg-black/55" />
          <div className="absolute inset-0 grid place-items-center">
            <div className="flex flex-col items-center gap-2.5">
              <span className="h-7 w-7 animate-spin rounded-full border-2 border-white/25 border-t-[var(--nf-accent)]" />
              <p className="text-[12px] font-medium text-white/55">Buscando o stream…</p>
            </div>
          </div>
        </div>
      )}

      {picked && nativeActive && nativeState === "ready" && (
        <NativePlayer
          sources={nativeSources}
          isPanel={isPanelTitle}
          poster={playerPoster}
          title={`${title.name}${title.kind === "series" ? ` · S${season} E${episode}` : ""}`}
          startAt={startAt}
          onTick={({ current, total }) => {
            if (!total) return;
            /* tudo26: o vídeo que está tocando tem duração muito diferente
               da do filme do detalhe? É outro filme com o mesmo nome (o
               arquivo do painel é o do filme errado). Avisa uma vez, sem
               parar o vídeo — o usuário decide. Só para filmes do painel
               com duração esperada conhecida. */
            if (
              isPanelTitle &&
              title.kind === "movie" &&
              detailDuration &&
              !mismatchChecked.current
            ) {
              const actualMin = Math.round(total / 60);
              const diff = Math.abs(actualMin - detailDuration);
              if (diff > 20 && diff > detailDuration * 0.25) {
                mismatchChecked.current = true;
                setDurationMismatch({ expectedMin: detailDuration, actualMin });
              }
            }
            setProgress(title.slug, {
              season: title.kind === "series" ? season : 1,
              episode: title.kind === "series" ? episode : 1,
              percent: Math.min(1, Math.max(0, current / total)),
              seconds: current,
              duration: total,
              updated: Date.now(),
              /* tudo26: metadados para a fileira "Continuar assistindo". */
              name: displayName,
              kind: title.kind,
              panelType: title.panel?.type,
              panelId: title.panel?.id,
              year: title.year > 0 ? title.year : undefined,
            });
          }}
          onEnded={() => {
            if (nextEp) goTo(nextEp.season, nextEp.episode);
          }}
          onNext={nextEp ? () => goTo(nextEp.season, nextEp.episode) : undefined}
          nextLabel={nextEp ? nextEpisodeLabel : undefined}
          onError={() => {
            /* títulos do painel não têm embed de reserva (tmdbId 0) — fica
               no player próprio e o NativePlayer mostra o "Tentar novamente" */
            if (isPanelTitle) {
              toast("O stream do painel não respondeu — tente novamente");
              return;
            }
            /* this title's stream is dead: drop to an embed for now, but don't
               remember it — the next visit should try our player again */
            setNativeMode(false);
            toast("O player CinePlus não começou — usando um servidor de reserva");
          }}
        />
      )}

      {/* tudo26: aviso de filme errado — a duração do vídeo não bate com
          a do filme do detalhe. Não trava nada; o usuário decide. */}
      {picked && durationMismatch && (
        <div className="absolute inset-x-0 top-16 z-40 flex justify-center px-4 md:top-20">
          <div className="pointer-events-auto w-full max-w-[520px] rounded-xl border border-amber-400/40 bg-[#1a1405]/95 p-4 shadow-2xl backdrop-blur">
            <p className="text-[13px] font-semibold text-amber-200">
              Este vídeo parece ser outro filme
            </p>
            <p className="mt-1 text-[12.5px] leading-relaxed text-white/70">
              A duração do vídeo ({formatMinutes(durationMismatch.actualMin)}) não bate
              com a do filme ({formatMinutes(durationMismatch.expectedMin)}). O arquivo
              do painel pode ser de outro título com o mesmo nome.
            </p>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                onClick={findCorrectTitle}
                disabled={findingCorrect}
                className="rounded-full bg-[#e50914] px-4 py-2 text-[12.5px] font-bold text-white transition disabled:opacity-60"
              >
                {findingCorrect ? "Buscando…" : "Buscar o título certo"}
              </button>
              <button
                type="button"
                onClick={() => setDurationMismatch(null)}
                className="rounded-full border border-white/20 px-4 py-2 text-[12.5px] font-semibold text-white/85 transition hover:border-white/50"
              >
                Continuar assistindo
              </button>
            </div>
          </div>
        </div>
      )}

      {picked && !nativeActive && !isPanelTitle && mounted && aniState !== "pending" && (
        <iframe
          ref={iframeRef}
          key={src}
          src={src}
          title={`${title.name} · CinePlus`}
          allow="autoplay; fullscreen; encrypted-media; picture-in-picture; presentation"
          allowFullScreen
          referrerPolicy="origin"
          loading="eager"
          onLoad={() => {
            loadedRef.current = true;
            setLoaded(true);
          }}
          onError={() => hardFallback()}
          className="absolute inset-0 z-10 h-full w-full border-0"
        />
      )}

      {/* loaded but nothing playing: an explicit way out, never automatic */}
      <AnimatePresence>
        {stalled && !nativeActive && !isPanelTitle && nextUp && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ duration: 0.18 }}
            className="absolute inset-x-0 bottom-20 z-20 flex justify-center px-4"
          >
            <button
              type="button"
              onClick={() => {
                setStalled(false);
                cycleServer();
              }}
              className="pointer-events-auto rounded-full border border-white/20 bg-[#0f1220]/95 px-4 py-2 text-[12px] font-semibold text-white shadow-2xl backdrop-blur-md transition hover:border-[var(--nf-accent)] hover:bg-[var(--nf-accent)]"
            >
              Nada tocando ainda? Tente {playerMeta(nextUp).label} →
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* thin load bar, top edge — instant, non-blocking feedback */}
      <AnimatePresence>
        {!loaded && mounted && aniState !== "pending" && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="pointer-events-none absolute inset-x-0 top-0 z-40 h-[2px] overflow-hidden bg-white/10"
          >
            <motion.div
              initial={{ x: "-40%" }}
              animate={{ x: "140%" }}
              transition={{ repeat: Infinity, duration: 1.05, ease: "linear" }}
              className="h-full w-1/3 bg-[var(--nf-accent)]"
            />
          </motion.div>
        )}
      </AnimatePresence>

      {/* everything below is click-through; only real buttons take input */}
      <div className="pointer-events-none absolute inset-0 z-30">
        {/* top-left: back + what's playing */}
        <AnimatePresence>
          {showChrome && (
            <motion.div
              initial={{ opacity: 0, x: -8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -8 }}
              transition={{ duration: 0.16 }}
              className="absolute left-3 top-3 flex items-center gap-2 md:left-5 md:top-4"
            >
              <button
                type="button"
                onClick={() => router.back()}
                aria-label="Voltar"
                className="pointer-events-auto grid h-10 w-10 place-items-center rounded-full bg-black/60 text-white/90 backdrop-blur-md transition hover:bg-black/80 hover:text-white"
              >
                <ArrowLeftIcon width={20} height={20} />
              </button>

              <div className="max-w-[42vw] rounded-full bg-black/60 px-3 py-1.5 backdrop-blur-md">
                {isPanelTitle && (
                  <p className="text-[9px] font-bold uppercase tracking-[0.22em] text-[#e50914]">
                    Você está assistindo
                  </p>
                )}
                <p className="truncate text-[12.5px] font-semibold leading-tight text-white">
                  {displayName}
                </p>
                <p className="truncate text-[10.5px] leading-tight text-white/55">
                  {title.kind === "series"
                    ? `S${season} · E${episode}${nextEp ? " · próximo pronto" : ""}`
                    : `${title.year > 0 ? `${title.year} · ` : ""}${title.maturity}`}
                </p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* top-right: next episode + source picker */}
        <AnimatePresence>
          {showChrome && (
            <motion.div
              initial={{ opacity: 0, x: 8 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 8 }}
              transition={{ duration: 0.16 }}
              className="absolute right-3 top-3 z-30 flex items-center gap-2 md:right-5 md:top-4"
            >
              {nextEp && (
                <button
                  type="button"
                  onClick={() => goTo(nextEp.season, nextEp.episode)}
                  className="pointer-events-auto flex h-10 items-center gap-1.5 rounded-full bg-black/60 px-3 text-[12px] font-semibold text-white/90 backdrop-blur-md transition hover:bg-black/80 hover:text-white"
                  aria-label="Próximo episódio"
                >
                  <NextIcon width={16} height={16} />
                  <span className="hidden sm:inline">Próximo</span>
                </button>
              )}

              {/* tudo17: botão grande e claro de episódios — fora do menu
                  "Painel", sempre visível no topo do player para séries. */}
              {title.kind === "series" && (
                <button
                  type="button"
                  onClick={() => {
                    setSheetSeason(null);
                    setEpisodesOpen((open) => !open);
                  }}
                  aria-label="Episódios"
                  aria-pressed={episodesOpen}
                  className={cn(
                    "pointer-events-auto flex h-10 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold backdrop-blur-md transition",
                    episodesOpen
                      ? "bg-white text-black"
                      : "bg-black/60 text-white/85 hover:bg-black/80 hover:text-white",
                  )}
                >
                  <ListIcon width={16} height={16} />
                  <span className="hidden sm:inline">Episódios</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setMenu((open) => !open)}
                aria-label="Opções do player"
                className={cn(
                  "pointer-events-auto flex h-10 items-center gap-1.5 rounded-full px-3 text-[12px] font-semibold backdrop-blur-md transition",
                  menu
                    ? "bg-white text-black"
                    : "bg-black/60 text-white/85 hover:bg-black/80 hover:text-white",
                )}
              >
                <span
                  className={cn(
                    "h-1.5 w-1.5 rounded-full",
                    (nativeActive ? nativeState === "ready" : loaded)
                      ? "bg-[#46d369]"
                      : "bg-amber-400",
                  )}
                />
                {isPanelTitle ? "Painel" : nativeActive ? "CinePlus Player" : activePlayer.label}
                <ChevronDownIcon width={13} height={13} />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* options panel */}
        <AnimatePresence>
          {menu && (
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.14 }}
              className="pointer-events-auto absolute right-3 top-16 z-40 max-h-[76vh] w-[286px] overflow-y-auto overscroll-contain rounded-xl border border-white/10 bg-[#0f1220]/[0.98] p-1.5 shadow-2xl backdrop-blur-xl md:right-5"
            >
              <p className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
                Player
              </p>
              {/* painel: seletor SELECT SERVER com o servidor único */}
              {isPanelTitle && (
                <>
                  <p className="mt-1 px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
                    Escolher servidor
                  </p>
                  <Row
                    active
                    title={
                      <span className="flex items-center gap-1.5">
                        Painel
                        <span className="rounded-sm bg-[#46d369] px-1 py-[1px] text-[8px] font-bold uppercase tracking-wide text-black">
                          Conectado
                        </span>
                        <span className="rounded-sm bg-white/15 px-1 py-[1px] text-[8px] font-bold uppercase tracking-wide text-white/80">
                          FHD
                        </span>
                      </span>
                    }
                    subtitle="Servidor do painel · qualidade única"
                    onClick={() => setMenu(false)}
                  />
                  <p className="px-2.5 pb-2 pt-1 text-[10.5px] leading-relaxed text-white/35">
                    Este conteúdo vem do seu painel em uma qualidade só.
                  </p>
                </>
              )}
              <Row
                active={nativeMode && nativeState !== "none"}
                title={
                  <span className="flex items-center gap-1.5">
                    CinePlus Player
                    <span className="rounded-sm bg-[var(--nf-accent)] px-1 py-[1px] text-[8px] font-bold uppercase tracking-wide text-white">
                      Native
                    </span>
                  </span>
                }
                subtitle={
                  nativeState === "none"
                    ? "Sem stream direto — usando um servidor de reserva"
                    : "Nosso player · continuar, qualidade, legendas"
                }
                disabled={nativeState === "none"}
                onClick={() => {
                  setNativeMode(true);
                  localStorage.setItem("nf.native3", "1");
                  setMenu(false);
                  toast("Tocando no player CinePlus");
                }}
              />
              {!isPanelTitle && (
                <>
              <p className="mt-1 px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
                Servidores de reserva
              </p>
              {orderedPlayers.map((item) => {
                const available = canPlayNow(item.id);
                return (
                  <Row
                    key={item.id}
                    active={player === item.id}
                    title={
                      <span className="flex items-center gap-1.5">
                        {item.label}
                        {item.badge && (
                          <span className="rounded-sm bg-[var(--nf-accent)] px-1 py-[1px] text-[8px] font-bold uppercase tracking-wide text-white">
                            {item.badge}
                          </span>
                        )}
                      </span>
                    }
                    subtitle={available ? item.hint : "Sem stream para este título"}
                    disabled={!available}
                    onClick={() => changePlayer(item.id)}
                  />
                );
              })}

              <p className="mt-1 px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
                Solução de problemas
              </p>
              <Row
                title="Próximo servidor"
                subtitle="Se este não iniciar"
                onClick={cycleServer}
              />
              <a
                href={src}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMenu(false)}
                className="pointer-events-auto flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left transition hover:bg-white/10"
              >
                <span className="min-w-0">
                  <span className="block truncate text-[12.5px] font-medium text-white/90">
                    Abrir em nova guia
                  </span>
                  <span className="block truncate text-[10.5px] text-white/45">
                    Se o player do site estiver bloqueado
                  </span>
                </span>
              </a>
                </>
              )}

              {anime && (
                <>
                  <p className="mt-1 px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
                    Anime audio
                  </p>
                  <Row
                    active={audio === "sub"}
                    title="Legendado"
                    subtitle="Japanese audio · subtitles on"
                    onClick={() => updateSettings({ animeAudio: "sub" })}
                  />
                  <Row
                    active={audio === "dub"}
                    title="Dublado"
                    subtitle="Faixa de áudio em inglês"
                    onClick={() => updateSettings({ animeAudio: "dub" })}
                  />
                </>
              )}

              {player === "cinelite" ? (
                <>
                  <p className="mt-1 px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
                    Default quality
                  </p>
                  {QUALITIES.map((item) => (
                    <Row
                      key={item}
                      active={quality === item}
                      title={item.toUpperCase()}
                      onClick={() => changeQuality(item)}
                    />
                  ))}
                </>
              ) : (
                <p className="mt-1 flex items-start gap-1.5 px-2.5 pb-2 pt-2 text-[10.5px] leading-relaxed text-white/35">
                  <SubtitlesIcon width={13} height={13} className="mt-[1px] shrink-0" />
                  Qualidade, legendas e áudio ficam na barra do {activePlayer.label}.
                </p>
              )}

              {title.kind === "series" && (
                <>
                  <p className="mt-1 border-t border-white/10 px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
                    A seguir
                  </p>
                  {nextEp ? (
                    <Row
                      active={false}
                      title={`S${nextEp.season}:E${nextEp.episode} · ${
                        (allSeasons.find((s) => s.number === nextEp.season)?.episodes.find(
                          (e) => e.number === nextEp.episode,
                        )?.name) ?? "Próximo episódio"
                      }`}
                      subtitle="Reproduzir próximo"
                      onClick={() => goTo(nextEp.season, nextEp.episode)}
                    />
                  ) : (
                    <p className="px-2.5 pb-2 text-[11px] text-white/35">Você está no último episódio.</p>
                  )}

                  {currentSeason && (
                    <>
                      <p className="mt-1 px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
                        {currentSeason.name && !/^Season \d+$/.test(currentSeason.name)
                          ? currentSeason.name
                          : `Temporada ${season}`}
                        {allSeasons.length > 1 ? ` · ${allSeasons.length} temporadas` : ""}
                      </p>
                      {allSeasons.length > 1 && (
                        <div className="mb-1 flex gap-1 overflow-x-auto px-2.5 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                          {allSeasons.map((entry) => (
                            <button
                              key={entry.number}
                              type="button"
                              onClick={() => goTo(entry.number, 1)}
                              aria-pressed={entry.number === season}
                              className={
                                entry.number === season
                                  ? "shrink-0 rounded border border-white/70 bg-white/15 px-2 py-0.5 text-[11px] font-semibold text-white"
                                  : "shrink-0 rounded border border-white/10 px-2 py-0.5 text-[11px] text-white/60 transition hover:border-white/40 hover:text-white"
                              }
                            >
                              {entry.name && !/^Season \d+$/.test(entry.name)
                                ? entry.name
                                : `S${entry.number}`}
                            </button>
                          ))}
                        </div>
                      )}
                      <div className="max-h-[190px] overflow-y-auto">
                        {currentSeason.episodes.map((item) => (
                          <Row
                            key={item.number}
                            active={episode === item.number}
                            title={`E${item.number} · ${item.name}`}
                            subtitle={item.runtime > 0 ? `${item.runtime} min` : undefined}
                            onClick={() => goTo(season, item.number)}
                          />
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}

              <div className="mt-1 flex items-center justify-between gap-2 border-t border-white/10 px-2.5 pb-2 pt-2">
                <span className="text-[10.5px] text-white/35">N · próximo episódio</span>
                <button
                  type="button"
                  onClick={restart}
                  className="text-[10.5px] font-semibold text-white/55 transition hover:text-white"
                >
                  Reiniciar stream
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* up next card — Netflix-style, answers the "no next episode" gap */}
        <AnimatePresence>
          {upNext && nextEp && (
            <motion.div
              initial={{ opacity: 0, y: 24 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 18 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              className="pointer-events-auto absolute bottom-[92px] right-3 z-30 w-[320px] max-w-[92vw] overflow-hidden rounded-lg border border-white/10 bg-[#0d0d0d]/95 shadow-[0_18px_60px_rgba(0,0,0,0.65)] backdrop-blur-xl md:bottom-[104px] md:right-6"
            >
              <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                <p className="text-[9.5px] font-semibold uppercase tracking-[0.26em] text-[var(--nf-accent)]">
                  A seguir
                </p>
                <span className="text-[10px] text-white/45">
                  em {Math.max(upNext.left, 0)}s
                </span>
              </div>

              <button
                type="button"
                onClick={() => goTo(nextEp.season, nextEp.episode)}
                className="group flex w-full items-center gap-2.5 p-2.5 text-left transition hover:bg-white/5"
              >
                <span className="relative block h-[54px] w-[96px] shrink-0 overflow-hidden rounded-[4px] bg-[#1b1b1b]">
                  <Artwork
                    slug={title.slug}
                    name={title.name}
                    kind="backdrop"
                    accent={title.accent}
                    sizes="96px"
                  />
                  <span className="absolute inset-0 grid place-items-center bg-black/35 opacity-0 transition group-hover:opacity-100">
                    <PlayIcon width={14} height={14} />
                  </span>
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[12px] font-semibold text-white">
                    S{nextEp.season}:E{nextEp.episode} ·{" "}
                    {(allSeasons
                      .find((s) => s.number === nextEp.season)
                      ?.episodes.find((e) => e.number === nextEp.episode)?.name) ?? "Próximo episódio"}
                  </span>
                  <span className="mt-0.5 block truncate text-[10.5px] text-white/45">
                    {title.name} · {activePlayer.label}
                  </span>
                </span>
              </button>

              <div className="flex items-center gap-2 px-2.5 pb-2.5">
                <button
                  type="button"
                  onClick={() => goTo(nextEp.season, nextEp.episode)}
                  className="flex-1 rounded-[4px] bg-white py-1.5 text-[11.5px] font-semibold text-black transition hover:bg-white/85"
                >
                  Assistir
                </button>
                <button
                  type="button"
                  onClick={() => {
                    dismissed.current = true;
                    setUpNext(null);
                  }}
                  className="rounded-[4px] border border-white/20 px-3 py-1.5 text-[11.5px] font-medium text-white/75 transition hover:border-white/40 hover:text-white"
                >
                  Cancel
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* pause suggestions */}
        <AnimatePresence>
          {showRail && (
            <motion.aside
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 16 }}
              transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
              className="pointer-events-auto absolute bottom-[92px] right-3 z-20 w-[300px] max-w-[92vw] overflow-hidden rounded-lg border border-white/10 bg-[#0d0d0d]/94 shadow-[0_18px_60px_rgba(0,0,0,0.6)] backdrop-blur-xl md:bottom-[104px] md:right-6 md:w-[460px]"
            >
              <div className="flex items-start justify-between gap-3 border-b border-white/10 px-3.5 py-2.5">
                <div>
                  <p className="text-[9.5px] font-semibold uppercase tracking-[0.26em] text-[var(--nf-accent)]">
                    Pausado
                  </p>
                  <h2 className="mt-0.5 text-[13.5px] font-semibold text-white md:text-[15px]">
                    Mais como este
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setShowSuggestions(false)}
                  aria-label="Hide suggestions"
                  className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-white/50 transition hover:bg-white/10 hover:text-white"
                >
                  <CloseIcon width={14} height={14} />
                </button>
              </div>

              <div className="grid grid-cols-3 gap-1.5 p-2 md:gap-2 md:p-2.5">
                {suggestions.map((item) => (
                  <button
                    key={item.slug}
                    type="button"
                    onClick={() => router.push(appUrl(`/watch/${item.kind}/${item.slug}`))}
                    className="group relative overflow-hidden rounded-[4px] bg-[#1b1b1b] text-left ring-1 ring-white/5 transition duration-200 hover:z-10 hover:ring-white/40"
                  >
                    <span className="relative block aspect-[2/3] w-full overflow-hidden">
                      <Artwork
                        slug={item.slug}
                        name={item.name}
                        accent={item.accent}
                        sizes="(max-width: 768px) 30vw, 150px"
                      />
                      <span className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-transparent opacity-0 transition group-hover:opacity-100" />
                      <span className="absolute inset-0 grid place-items-center opacity-0 transition group-hover:opacity-100">
                        <span className="grid h-9 w-9 place-items-center rounded-full border-2 border-white bg-black/40 text-white">
                          <PlayIcon width={13} height={13} />
                        </span>
                      </span>
                      <span className="absolute left-1 top-1 rounded-sm bg-black/70 px-1 py-0.5 text-[8px] font-bold uppercase tracking-wider text-white/85">
                        {item.kind === "series" ? "Séries" : "Filme"}
                      </span>
                    </span>
                    <span className="block px-1.5 pb-1.5 pt-1">
                      <span className="block truncate text-[10.5px] font-medium leading-tight text-white/90">
                        {item.name}
                      </span>
                      <span className="mt-0.5 flex items-center gap-1 text-[9px] text-white/45">
                        <span className="font-semibold text-[#46d369]">{item.match}% match</span>
                        <span>·</span>
                        <span className="truncate">{shortMeta(item)}</span>
                      </span>
                    </span>
                  </button>
                ))}
              </div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* wordmark while the stream boots */}
        <AnimatePresence>
          {!playing && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute bottom-5 left-5 hidden md:block"
            >
              <Wordmark className="text-lg opacity-35" asLink={false} />
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* tudo20: lista de episódios durante a reprodução — bottom sheet de
          verdade: ocupa só a parte de baixo da tela e deixa o vídeo visível
          acima (nada de modal central cobrindo o vídeo). Abre só pelo botão
          "Episódios" do topo; a escolha principal acontece na visão de
          detalhe, antes de tocar. */}
      <AnimatePresence>
        {episodesOpen && title.kind === "series" && (
          <motion.div
            initial={{ opacity: 0, y: 60 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 60 }}
            transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
            role="dialog"
            aria-label="Episódios"
            className="absolute inset-x-0 bottom-0 z-40 flex max-h-[46vh] w-full flex-col overflow-hidden rounded-t-2xl border border-t border-white/10 bg-[#141414] shadow-[0_-12px_48px_rgba(0,0,0,0.6)] md:max-h-[52vh]"
          >
            <div className="mx-auto mt-2.5 h-1 w-10 shrink-0 rounded-full bg-white/25" />
            <div className="flex items-start justify-between gap-3 px-4 pb-1 pt-3 md:px-6">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">
                  Episódios
                </p>
                <h2 className="mt-0.5 truncate text-[16px] font-bold text-white md:text-lg">
                  {title.name}
                </h2>
                <p className="mt-0.5 text-[12px] text-white/55">
                  {allSeasons.length > 0
                    ? `Assistindo: Temporada ${season} · Episódio ${episode}`
                    : "Carregando temporadas e episódios…"}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEpisodesOpen(false)}
                aria-label="Fechar episódios"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/[0.06] text-white/70 transition hover:bg-white/15 hover:text-white"
              >
                <CloseIcon width={14} height={14} />
              </button>
            </div>

            {allSeasons.length === 0 ? (
              <div className="grid flex-1 place-items-center px-4 pb-8">
                {panelSeasonsLoaded ? (
                  <div className="text-center">
                    <p className="text-[13px] text-white/55">
                      O painel não devolveu a lista de episódios desta série.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        goTo(1, 1);
                        setEpisodesOpen(false);
                      }}
                      className="mt-4 rounded-md bg-white px-6 py-3 text-[14px] font-bold text-black transition hover:bg-white/85"
                    >
                      Assistir · Temporada 1 · Episódio 1
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2.5">
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-white/25 border-t-[var(--nf-accent)]" />
                    <p className="text-[13px] font-medium text-white/55">
                      Carregando temporadas e episódios…
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <>
                {allSeasons.length > 1 && (
                  <div className="mt-2 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:px-6 [&::-webkit-scrollbar]:hidden">
                    {allSeasons.map((entry) => (
                      <button
                        key={entry.number}
                        type="button"
                        onClick={() => setSheetSeason(entry.number)}
                        aria-pressed={entry.number === sheetSeasonData?.number}
                        className={
                          entry.number === sheetSeasonData?.number
                            ? "shrink-0 rounded-full bg-white px-4 py-2 text-[13px] font-bold text-black"
                            : "shrink-0 rounded-full border border-white/15 bg-white/[0.04] px-4 py-2 text-[13px] font-medium text-white/60 transition hover:border-white/40 hover:text-white"
                        }
                      >
                        {entry.name && !/^Season \d+$/.test(entry.name)
                          ? entry.name
                          : `Temporada ${entry.number}`}
                      </button>
                    ))}
                  </div>
                )}
                <p className="px-4 pt-2 text-[12px] font-semibold uppercase tracking-[0.16em] text-white/40 md:px-6">
                  {sheetSeasonData?.name && !/^Season \d+$/.test(sheetSeasonData.name)
                    ? sheetSeasonData.name
                    : `Temporada ${sheetSeasonData?.number ?? season}`}
                  {allSeasons.length > 1 ? ` · ${allSeasons.length} temporadas` : ""}
                </p>
                <div className="mt-1 flex-1 overflow-y-auto px-2 pb-4 md:px-4">
                  {(sheetSeasonData?.episodes ?? []).map((item) => {
                    const active =
                      sheetSeasonData?.number === season && item.number === episode;
                    return (
                      <EpisodeRow
                        key={item.number}
                        number={item.number}
                        name={item.name}
                        runtime={item.runtime}
                        overview={item.overview}
                        active={active}
                        onClick={() => {
                          goTo(sheetSeasonData?.number ?? season, item.number);
                          setEpisodesOpen(false);
                        }}
                      />
                    );
                  })}
                </div>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/**
 * Linha de episódio estilo Netflix (tudo20): número grande, título, duração
 * e sinopse; o episódio atual leva o selo "Assistindo" em ciano. Usada na
 * visão de detalhe da série e no bottom sheet do player. Alvo grande para
 * o dedo (linha inteira clicável, py-4) e sem texto cortado em telas pequenas.
 */
function EpisodeRow({
  number,
  name,
  runtime,
  overview,
  active = false,
  onClick,
}: {
  number: number;
  name: string;
  runtime?: number;
  overview?: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group flex w-full items-start gap-3 border-b border-white/[0.06] px-2 py-4 text-left transition last:border-b-0 hover:bg-white/[0.04] md:gap-4 md:px-3",
        active && "bg-white/[0.05]",
      )}
    >
      <span
        className={cn(
          "w-8 shrink-0 pt-0.5 text-center text-[26px] font-bold leading-none md:w-10 md:text-[30px]",
          active ? "text-white" : "text-white/30 group-hover:text-white/60",
        )}
      >
        {number}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-2">
          <span
            className={cn(
              "text-[15px] font-semibold",
              active ? "text-white" : "text-white/90",
            )}
          >
            {name}
          </span>
          {(runtime ?? 0) > 0 && (
            <span className="shrink-0 text-[12px] text-white/45">{runtime} min</span>
          )}
        </span>
        {overview ? (
          <span className="mt-1 line-clamp-2 block text-[13px] leading-relaxed text-white/55">
            {overview}
          </span>
        ) : null}
      </span>
      {active ? (
        <span className="mt-1 shrink-0 rounded-full bg-[var(--nf-accent)] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wide text-white">
          Assistindo
        </span>
      ) : (
        <span className="mt-1 grid h-9 w-9 shrink-0 place-items-center rounded-full border border-white/20 text-white/70 transition group-hover:border-white/60 group-hover:text-white">
          <PlayIcon width={14} height={14} />
        </span>
      )}
    </button>
  );
}

function Row({
  title,
  subtitle,
  active,
  disabled,
  onClick,
}: {
  title: React.ReactNode;
  subtitle?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition",
        active ? "bg-white/10" : "hover:bg-white/5",
        disabled && "cursor-not-allowed opacity-40 hover:bg-transparent",
      )}
    >
      <span className="grid w-4 shrink-0 place-items-center text-[var(--nf-accent)]">
        {active ? <CheckIcon width={13} height={13} /> : null}
      </span>
      <span className="min-w-0 flex-1">
        <span className={cn("block truncate text-[13px]", active ? "text-white" : "text-white/80")}>
          {title}
        </span>
        {subtitle && <span className="block truncate text-[11px] text-white/40">{subtitle}</span>}
      </span>
    </button>
  );
}
