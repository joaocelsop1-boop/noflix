"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FullscreenIcon,
  ChevronDownIcon,
  MuteIcon,
  PauseIcon,
  PlayIcon,
  ForwardIcon,
  RewindIcon,
  SubtitlesIcon,
  VolumeIcon,
} from "@/components/icons";
import { cn } from "@/lib/cn";
import { ReportBrokenButton, type ReportBrokenInfo } from "@/components/report-broken-button";

export type NativeSource = {
  /** the CDN itself — played straight from the viewer's IP */
  url: string;
  /** signed same-origin relay, used only if the CDN refuses the direct hit */
  proxy?: string;
  type: "hls" | "mp4";
  quality?: string;
  codec?: "h264" | "hevc" | "unknown";
  label: string;
};

/** Can this browser decode HEVC? Plenty of provider files are h265-only. */
function hevcSupported() {
  if (typeof document === "undefined") return true;
  try {
    const probe = document.createElement("video");
    return (
      probe.canPlayType('video/mp4; codecs="hvc1.1.6.L93.B0"') !== "" ||
      probe.canPlayType('video/mp4; codecs="hev1.1.6.L93.B0"') !== ""
    );
  } catch {
    return false;
  }
}

const fmt = (value: number) => {
  if (!Number.isFinite(value) || value < 0) return "0:00";
  const total = Math.floor(value);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
};

type Level = { index: number; label: string };

/**
 * CinePlus's own player.
 *
 * hls.js owns the transport, we own every pixel: Netflix-shaped controls,
 * resume, quality, captions, PiP, fullscreen and keyboard shortcuts. No
 * third-party iframe, no someone else's menu, no ads on top of the picture.
 */
export function NativePlayer({
  sources,
  title,
  startAt,
  autoPlay = true,
  onTick,
  onEnded,
  onError,
  onNext,
  nextLabel,
  isPanel = false,
  poster,
  /** tudo29: dados do título para o botão "Avisar que não funcionou" —
   * só aparece na tela de erro de reprodução, e só quando o dono
   * configurou o Telegram no admin (enabled=true). */
  report,
}: {
  sources: NativeSource[];
  title: string;
  startAt?: number | null;
  autoPlay?: boolean;
  /** tudo23: backdrop grande como fundo do player (16:9) antes do vídeo */
  poster?: string;
  onTick?: (state: { current: number; total: number }) => void;
  onEnded?: () => void;
  onError?: () => void;
  /** play the next episode — powers the Netflix-style end card */
  onNext?: () => void;
  nextLabel?: string;
  /** título do painel: sem servidor de reserva (não há embed) */
  isPanel?: boolean;
  report?: (ReportBrokenInfo & { enabled: boolean }) | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hlsRef = useRef<import("hls.js").default | null>(null);
  /**
   * Reforço de volume (Web Audio): o volume do <video> só vai até 1 (100%)
   * e o áudio do painel chega baixo. O GainNode amplifica até 4x (400%).
   * Criado uma única vez por elemento (createMediaElementSource só pode
   * ser chamado uma vez) e reutilizado em todas as trocas de fonte.
   *
   * O boost é ligado quando a reprodução começa (não só quando o usuário
   * toca nos controles): sem isso, quem assiste no autoplay nunca tinha
   * o reforço e o volume ficava baixo mesmo com o padrão em 150%.
   */
  const audioBoost = useRef<{ ctx: AudioContext; gain: GainNode } | null>(null);
  /** Ganho alvo (0 a 4). O slider de volume controla este valor. */
  const gainTarget = useRef(2);
  const ensureAudioBoost = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!audioBoost.current) {
      try {
        const Ctx =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctx) return;
        const ctx = new Ctx();
        const gain = ctx.createGain();
        gain.gain.value = gainTarget.current;
        ctx.createMediaElementSource(video).connect(gain);
        gain.connect(ctx.destination);
        audioBoost.current = { ctx, gain };
      } catch {
        audioBoost.current = null;
      }
    }
    const boost = audioBoost.current;
    if (boost) {
      if (boost.ctx.state === "suspended") void boost.ctx.resume().catch(() => undefined);
      boost.gain.gain.value = gainTarget.current;
    }
    // O volume do elemento fica em 1: o ganho é quem controla o volume.
    video.volume = 1;
  }, []);
  const videoEl = useCallback((node: HTMLVideoElement | null) => {
    videoRef.current = node;
    /* no `crossOrigin`: provider CDNs rarely send CORS headers, and a plain
       media load plays opaquely. And no Referer, which is exactly what their
       hotlink checks look at — React's typings just don't know the attribute. */
    if (node) node.setAttribute("referrerpolicy", "no-referrer");
  }, []);
  const shellRef = useRef<HTMLDivElement>(null);
  const hideTimer = useRef<number | null>(null);
  const lastSaved = useRef(0);
  const recovery = useRef({ network: 0, media: 0, escalated: false });
  /**
   * Mid-playback stall watchdog (tudo12): the 25s load timeout only guards
   * the initial load. Once playback has started, a hung upstream leaves the
   * spinner on forever — currentTime stops advancing and nothing retries.
   * resumeOverride carries the position to resume at when the watchdog
   * reloads the same source; stallRef tracks freeze / recovery budget.
   */
  const resumeOverride = useRef<number | null>(null);
  /* tudo30: última posição conhecida da reprodução (atualizada a cada
     timeupdate) — é o que impede o filme de recomeçar do 0 quando o
     transporte recarrega: o watchdog e a escalada setam resumeOverride,
     mas um erro de rede ou uma troca de fonte que passe por outro caminho
     caía no startAt (ponto do resume inicial) ou no 0. Com a última
     posição conhecida, qualquer recarga retoma exatamente onde parou. */
  const lastKnownTime = useRef(0);
  const stallRef = useRef({
    lastTime: 0,
    stalledSince: null as number | null,
    recoveries: 0,
    hasPlayed: false,
    cooldownUntil: 0,
  });
  const failedRef = useRef(false);
  const onErrorRef = useRef(onError);
  /* tudo20: o watchdog do intervalo roda numa closure antiga, então espelha
     sourceIndex/playable em refs para ele ver a fonte atual. trialRef marca
     que a fonte atual veio do watchdog (troca por trava no meio) — se ela
     falhar no carregamento, o escalonamento volta para a fonte de onde
     veio em vez de mostrar erro. */
  const sourceIndexRef = useRef(0);
  /* inicializa vazio (playable é declarado abaixo) — o useEffect de
     sincronização o preenche antes de qualquer trava acontecer. */
  const playableRef = useRef<NativeSource[]>([]);
  const trialRef = useRef<{ from: number; to: number } | null>(null);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const [sourceIndex, setSourceIndex] = useState(0);
  /** 0 = straight to the CDN, 1 = through our relay */
  const [attempt, setAttempt] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [volume, setVolume] = useState(2);
  const [muted, setMuted] = useState(false);
  /* Sincroniza o ganho de volume (0 a 4) com o estado do slider. */
  useEffect(() => {
    gainTarget.current = volume;
    const boost = audioBoost.current;
    if (boost) boost.gain.gain.value = volume;
    const video = videoRef.current;
    if (video) video.volume = 1;
  }, [volume]);
  const [chrome, setChrome] = useState(true);
  const [menu, setMenu] = useState<null | "quality" | "captions" | "source" | "speed" | "audio">(null);
  const [levels, setLevels] = useState<Level[]>([]);
  /** -1 = Auto (ABR). Only ever set by the user opening the Quality menu. */
  const [level, setLevel] = useState(-1);
  /** the rendition actually on screen right now, for the menu label */
  const [activeLevel, setActiveLevel] = useState(-1);
  const [captionTracks, setCaptionTracks] = useState<Level[]>([]);
  const [caption, setCaption] = useState(-1);
  const [audioTracks, setAudioTracks] = useState<Level[]>([]);
  const [audio, setAudio] = useState(0);
  const [speed, setSpeed] = useState(1);
  const [failed, setFailed] = useState(false);
  const [flash, setFlash] = useState<null | "back" | "forward">(null);
  const [slow, setSlow] = useState(false);
  const [nextIn, setNextIn] = useState<number | null>(null);
  const [generation, setGeneration] = useState(0);
  const nextFired = useRef(false);
  const tap = useRef({ at: 0, x: 0, timer: 0 });

  /* drop h265-only files when this browser cannot decode them: a black screen
     is worse than starting on a lower resolution */
  const playable = useMemo(() => {
    const supportsHevc = hevcSupported();
    const keep = sources.filter((entry) => supportsHevc || entry.codec !== "hevc");
    return keep.length ? keep : supportsHevc ? sources : [];
  }, [sources]);

  /**
   * How each source is attempted, in order.
   *
   * hls.js fetches playlists with XHR, so a cross-origin CDN has to answer with
   * CORS headers — most of these hosts do not. The relay is same-origin, so HLS
   * goes through it first and only tries the CDN directly as a fallback.
   * A plain MP4 load is opaque to the browser and needs no CORS, so it goes
   * straight to the CDN (which is kind to residential IPs) and relays second.
   */
  const attempts = useMemo(
    () =>
      playable.map((entry) => {
        const relay = entry.proxy;
        const direct = entry.url;
        /* tudo19: sem duplicar a mesma URL — nas fontes do painel,
           url e proxy são a MESMA (stream.php), então tentar 2x era
           gastar 25s a mais no mesmo endereço morto antes de escalar
           para a próxima fonte. Para fontes com url ≠ proxy (CDN),
           nada muda: as duas tentativas continuam. */
        return entry.type === "hls"
          ? Array.from(new Set([relay, direct].filter(Boolean))) as string[]
          : Array.from(new Set([direct, relay].filter(Boolean))) as string[];
      }),
    [playable],
  );

  const sourceKey = useMemo(
    () => playable.map((entry) => `${entry.url}|${entry.proxy ?? ""}`).join("~"),
    [playable],
  );

  /* a new title means a new source list: start again from the first one */
  useEffect(() => {
    setSourceIndex(0);
    setAttempt(0);
    trialRef.current = null;
    resumeOverride.current = null;
    stallRef.current = {
      lastTime: 0,
      stalledSince: null,
      recoveries: 0,
      hasPlayed: false,
      cooldownUntil: 0,
    };
  }, [sourceKey]);

  /* ------------------------------------------------------------- transport */

  useEffect(() => {
    const video = videoRef.current;
    const source = playable[sourceIndex];
    const url = source ? (attempts[sourceIndex]?.[attempt] ?? null) : null;
    if (!video || !source || !url) return;

    let hls: import("hls.js").default | null = null;
    let cancelled = false;

    setWaiting(true);
    setFailed(false);
    setLevels([]);
    setActiveLevel(-1);
    setCaptionTracks([]);
    recovery.current = { network: 0, media: 0, escalated: false };

    /* stall recovery resumes where playback stopped (not where the title
       started): resumeOverride is set by the watchdog before it bumps the
       generation, and consumed once here. */
    /* tudo30: a posição de retomada NUNCA é 0 no meio do filme — a ordem
       é: override do watchdog/escalada → última posição conhecida
       (timeupdate) → ponto do "Continuar assistindo" (startAt) → 0 (só
       no início, quando nada tocou ainda). */
    const lastKnown = lastKnownTime.current > 0 ? lastKnownTime.current : null;
    const resumeAt =
      resumeOverride.current ?? lastKnown ?? (startAt && startAt > 20 ? startAt : 0);
    resumeOverride.current = null;
    let resumeRetryArmed = false;
    const nudgeResume = () => {
      if (!resumeAt) return;
      if (Number.isFinite(video.duration)) {
        if (Math.abs(video.currentTime - resumeAt) > 3) {
          video.currentTime = resumeAt;
        }
        return;
      }
      /* tudo30: a duração ainda não é conhecida (HLS: o manifesto chegou
         mas o elemento ainda não tem duration) — tenta de novo quando ela
         chegar, em vez de pular o seek em silêncio e começar do 0. */
      if (!resumeRetryArmed) {
        resumeRetryArmed = true;
        video.addEventListener("durationchange", nudgeResume, { once: true });
      }
    };

    const startPlayback = () => {
      if (!autoPlay) return;
      /* liga o reforço de volume junto com a reprodução: no autoplay
         ninguém toca nos controles, e sem esta chamada o ganho nunca
         era criado (o áudio ficava no volume 1.0 do elemento). */
      ensureAudioBoost();
      void video
        .play()
        .then(() => setWaiting(false))
        .catch(() => {
          /* most browsers only allow muted autoplay until a gesture */
          video.muted = true;
          setMuted(true);
          void video.play().catch(() => setWaiting(false));
        });
    };

    /** timers + element listeners we have to detach ourselves */
    const stalls: { src?: number; manifest?: number } = {};
    let mediaErrorHandler: (() => void) | null = null;

    /**
     * Give up on this attempt: the CDN refused, so relay it; the relay refused,
     * so move to the next source; nothing left, so hand the page to the embeds.
     */
    const escalate = () => {
      if (recovery.current.escalated) return;
      recovery.current.escalated = true;
      /* tudo30: a troca de fonte NÃO pode perder a posição — antes, um
         erro de rede no meio do filme escalava para a próxima fonte e o
         transporte recomeçava do 0 (ou do ponto do resume inicial),
         porque só o watchdog setava resumeOverride. Guarda a posição
         atual para o transporte retomar exatamente onde parou. No
         carregamento inicial currentTime é 0 e nada é guardado. */
      const currentVideo = videoRef.current;
      if (currentVideo && Number.isFinite(currentVideo.currentTime) && currentVideo.currentTime > 0) {
        resumeOverride.current = currentVideo.currentTime;
      }
      /* tudo21: a fonte atual veio do watchdog (troca por trava no meio) e
         não carregou — volta para a fonte de onde veio, na posição atual,
         em vez de mostrar erro. (tudo20 voltava sempre para o MP4 porque o
         MP4 era a 1ª fonte; no tudo22 o MP4 voltou a ser a 1ª fonte, então
         a volta é genérica: volta para trialRef.from.) */
      if (trialRef.current && sourceIndex === trialRef.current.to) {
        const back = trialRef.current.from;
        trialRef.current = null;
        const video = videoRef.current;
        if (video && Number.isFinite(video.currentTime)) {
          resumeOverride.current = video.currentTime;
        }
        setAttempt(0);
        setSourceIndex(back);
        return;
      }
      if (attempt + 1 < (attempts[sourceIndex]?.length ?? 1)) {
        setAttempt(attempt + 1);
        return;
      }
      if (sourceIndex + 1 < playable.length) {
        setSourceIndex((index) => index + 1);
        setAttempt(0);
        return;
      }
      setFailed(true);
      onError?.();
    };

    const bootstrap = async () => {
      /* hls.js first whenever it can drive the file: it is the only path that
         gives us a quality menu, audio tracks and clean error reporting. The
         element's own HLS path stays for iOS/Safari and for MP4. */
      if (source.type === "mp4") {
        /* the platform's own HLS/MP4 path (Safari, iOS): no hls.js involved, so
           the element itself has to tell us when a source is dead */
        mediaErrorHandler = () => escalate();
        video.addEventListener("error", mediaErrorHandler);
        stalls.src = window.setTimeout(() => {
          if (video.readyState < 2) escalate();
        }, 25_000);
        video.addEventListener(
          "playing",
          () => {
            window.clearTimeout(stalls.src);
            /* tudo21: a fonte de teste do watchdog tocou — virou a fonte
               real; se falhar depois, escala normal (não volta mais). */
            trialRef.current = null;
          },
          { once: true },
        );
        video.src = url;
        video.addEventListener("loadedmetadata", nudgeResume, { once: true });
        startPlayback();
        return;
      }

      /* tudo19 + tudo21: timeouts DUROS no caminho hls.js — o MP4 e o HLS
         nativo (Safari) têm o timeout de 25s que escala se não houver dado
         (readyState < 2), mas o caminho hls.js NÃO tinha nenhum: se o
         manifest não carregasse nem desse erro, o player ficava preso
         em "Conectando ao Painel…" para sempre (o retry interno do
         hls.js sozinho levava minutos). 25s, igual ao MP4; limpa no
         primeiro `playing`, igual ao MP4. No tudo21 o HLS era a 1ª fonte
         e o manifesto ganhou um timer PRÓPRIO de 10s (abaixo, em
         MEDIA_ATTACHED): sem manifesto em 10s, cai para o MP4 na hora.
         No tudo22 o MP4 voltou a ser a 1ª fonte (o painel não serve HLS
         para VOD) e o timer de 10s continua valendo quando o HLS entra
         como socorro. */
      stalls.src = window.setTimeout(() => {
        if (video.readyState < 2) escalate();
      }, 25_000);
      video.addEventListener(
        "playing",
        () => {
          window.clearTimeout(stalls.src);
          /* tudo21: a fonte de teste do watchdog tocou — virou a fonte
             real; se falhar depois, escala normal (não volta mais). */
          trialRef.current = null;
        },
        { once: true },
      );

      const module = await import("hls.js");
      const Hls = module.default;
      if (cancelled) return;

      if (!Hls.isSupported()) {
        /* Safari/iOS (or an ancient browser): the element plays HLS itself */
        if (!video.canPlayType("application/vnd.apple.mpegurl")) {
          escalate();
          return;
        }
        mediaErrorHandler = () => escalate();
        video.addEventListener("error", mediaErrorHandler);
        stalls.src = window.setTimeout(() => {
          if (video.readyState < 2) escalate();
        }, 25_000);
        video.src = url;
        video.addEventListener("loadedmetadata", nudgeResume, { once: true });
        startPlayback();
        return;
      }

      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
        /* Netflix-style quality: open on the best rendition the source has and
           only step *down* if bandwidth cannot keep up. The old settings made
           hls.js guess 500 kbps, so every title started on the 640x266 variant
           (and stayed there, because the small buffer kept ABR conservative). */
        startLevel: -1,
        abrEwmaDefaultEstimate: 6_000_000,
        abrBandWidthFactor: 0.9,
        abrBandWidthUpFactor: 0.85,
        capLevelToPlayerSize: false,
        testBandwidth: true,
        backBufferLength: 30,
        /* tudo21: buffer AGRESSIVO, igual a um app nativo — o player baixa
           bem mais vídeo à frente (até ~4 min ou 120 MB) para o buffer
           nunca esvaziar no meio do filme quando a internet oscila. Antes
           era 60s/120s/60 MB. */
        maxBufferLength: 90,
        maxMaxBufferLength: 240,
        maxBufferSize: 120 * 1000 * 1000,
        manifestLoadingTimeOut: 8_000,
        levelLoadingTimeOut: 8_000,
        fragLoadingTimeOut: 20_000,
        /* tudo19: falhar RÁPIDO — o padrão do hls.js é retentar o
           manifest até 6x (até 64s) antes de dar erro fatal, e o
           ERROR handler ainda dava 2x startLoad (cada um com o seu
           ciclo de 6 retries). Um manifest morto segurava o player
           por minutos em "Conectando ao Painel…". Com 1 retry o
           manifest morto vira erro fatal em ~25s, e o timeout duro
           abaixo garante a escalada de qualquer jeito. */
        manifestLoadingMaxRetry: 1,
        manifestLoadingRetryDelay: 1_000,
        manifestLoadingMaxRetryTimeout: 10_000,
        levelLoadingMaxRetry: 1,
        levelLoadingRetryDelay: 1_000,
        levelLoadingMaxRetryTimeout: 10_000,
        fragLoadingMaxRetry: 2,
        fragLoadingRetryDelay: 1_000,
        fragLoadingMaxRetryTimeout: 30_000,
        /* The CDNs hotlink on Referer, and a browser never lets us clear it on an
           XHR — but it does honour `referrerPolicy`. `context.url` is often a
           *relative* /api/hls path, and `new Request()` throws on those, which
           silently killed every playlist; resolve it against the page first. */
        fetchSetup: (context: { url: string }, initParams: RequestInit) =>
          new Request(new URL(context.url, window.location.href).toString(), {
            ...initParams,
            referrerPolicy: "no-referrer",
            credentials: "omit",
          }),
      });

      hlsRef.current = hls;
      hls.attachMedia(video);
      /* tudo30: o seek de retomada também no loadedmetadata — no
         MANIFEST_PARSED a duração do elemento pode ainda não existir. */
      video.addEventListener("loadedmetadata", nudgeResume, { once: true });

      hls.on(Hls.Events.MEDIA_ATTACHED, () => {
        hls?.loadSource(url);
        /* tudo21: timeout DURO de 10s no MANIFESTO — se a playlist .m3u8 não
           chegar nesse tempo (painel sem HLS para VOD, ou painel lento),
           cai para o MP4 na hora em vez de ficar preso em "Conectando…".
           É o que faltava no tudo18: lá o manifesto podia retentar por
           minutos. O timer de 25s (primeiro dado) continua valendo depois
           do manifesto carregado. */
        stalls.manifest = window.setTimeout(() => {
          if (!cancelled) escalate();
        }, 10_000);
      });
      hls.on(Hls.Events.MANIFEST_PARSED, (
        _event: unknown,
        data: { levels: Array<{ height?: number; width?: number; bitrate?: number }> },
      ) => {
        window.clearTimeout(stalls.manifest);
        /* a 1920x800 transfer is full HD in scope, so name it by its pixels
           instead of pretending it is "800p" */
        const label = (entry: { height?: number; width?: number; bitrate?: number }) => {
          const height = entry.height ?? 0;
          const width = entry.width ?? 0;
          if (height && width && height / width < 0.5) return `${width}×${height}`;
          if (height) return `${height}p`;
          return `${Math.round((entry.bitrate ?? 0) / 1000)}k`;
        };
        setLevels(
          data.levels.map((entry, index) => ({
            index,
            label: label(entry),
          })),
        );
        nudgeResume();
        startPlayback();
      });
      hls.on(Hls.Events.LEVEL_SWITCHED, (_event: unknown, data: { level: number }) =>
        setActiveLevel(data.level),
      );
      hls.on(
        Hls.Events.AUDIO_TRACKS_UPDATED,
        (_event: unknown, data: { audioTracks: Array<{ name?: string; lang?: string }> }) => {
          setAudioTracks(
            data.audioTracks.map((track, index) => ({
              index,
              label: track.name || track.lang?.toUpperCase() || `Audio ${index + 1}`,
            })),
          );
        },
      );
      hls.on(
        Hls.Events.SUBTITLE_TRACKS_UPDATED,
        (_event: unknown, data: { subtitleTracks: Array<{ name?: string; lang?: string }> }) => {
          setCaptionTracks(
            data.subtitleTracks.map((track, index) => ({
              index,
              label: track.name || track.lang || `Track ${index + 1}`,
            })),
          );
        },
      );
      const escalateInside = escalate;

      hls.on(Hls.Events.ERROR, (_event: unknown, data: { fatal: boolean; type: string }) => {
        if (!data.fatal || !hls) return;
        /* a few recoveries per source, then hand over to the next one — never
           retry the same dead manifest forever */
        if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
          if (recovery.current.network < 2) {
            recovery.current.network += 1;
            hls.startLoad();
            return;
          }
          escalateInside();
          return;
        }
        if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
          if (recovery.current.media < 2) {
            recovery.current.media += 1;
            hls.recoverMediaError();
            return;
          }
          escalateInside();
          return;
        }
        escalateInside();
      });
    };

    void bootstrap();

    return () => {
      cancelled = true;
      window.clearTimeout(stalls.src);
      window.clearTimeout(stalls.manifest);
      if (mediaErrorHandler) video.removeEventListener("error", mediaErrorHandler);
      hlsRef.current = null;
      hls?.destroy();
      video.removeAttribute("src");
      video.load();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceKey, sourceIndex, attempt, generation]);

  /* --------------------------------------------------------------- listeners */

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    const sync = () => {
      setTime(video.currentTime);
      setDuration(Number.isFinite(video.duration) ? video.duration : 0);
      const ranges = video.buffered;
      if (ranges.length) setBuffered(ranges.end(ranges.length - 1));
    };
    const onPlay = () => {
      setPlaying(true);
      setWaiting(false);
      /* retoma o AudioContext se a política de autoplay o suspendeu */
      ensureAudioBoost();
    };
    const onPause = () => setPlaying(false);
    const onWaiting = () => setWaiting(true);
    const onPlaying = () => {
      setWaiting(false);
      ensureAudioBoost();
    };
    const onVolume = () => {
      // O volume do elemento fica sempre em 1 (o ganho do Web Audio é quem
      // controla o volume) — aqui só sincroniza o mudo.
      setMuted(video.muted);
    };
    const onEnded = () => {
      setPlaying(false);
      onTick?.({ current: video.duration || 0, total: video.duration || 0 });
      onEnded?.();
    };
    const onTime = () => {
      /* tudo30: marca a última posição conhecida — é ela que o transporte
         usa para retomar se recarregar no meio do filme. */
      if (Number.isFinite(video.currentTime) && video.currentTime > 0) {
        lastKnownTime.current = video.currentTime;
      }
      sync();
      const now = Date.now();
      if (onTick && now - lastSaved.current > 5000) {
        lastSaved.current = now;
        onTick({ current: video.currentTime, total: video.duration || 0 });
      }
    };

    video.addEventListener("timeupdate", onTime);
    video.addEventListener("progress", sync);
    video.addEventListener("durationchange", sync);
    video.addEventListener("play", onPlay);
    video.addEventListener("pause", onPause);
    video.addEventListener("waiting", onWaiting);
    video.addEventListener("playing", onPlaying);
    video.addEventListener("volumechange", onVolume);
    video.addEventListener("ended", onEnded);

    return () => {
      video.removeEventListener("timeupdate", onTime);
      video.removeEventListener("progress", sync);
      video.removeEventListener("durationchange", sync);
      video.removeEventListener("play", onPlay);
      video.removeEventListener("pause", onPause);
      video.removeEventListener("waiting", onWaiting);
      video.removeEventListener("playing", onPlaying);
      video.removeEventListener("volumechange", onVolume);
      video.removeEventListener("ended", onEnded);
    };
  }, [onTick, onEnded]);

  /* playback speed, remembered across episodes */
  useEffect(() => {
    const stored = Number(window.localStorage.getItem("nf.speed"));
    if (Number.isFinite(stored) && stored >= 0.5 && stored <= 2) setSpeed(stored);
  }, []);

  useEffect(() => {
    if (videoRef.current) videoRef.current.playbackRate = speed;
    try {
      window.localStorage.setItem("nf.speed", String(speed));
    } catch {
      /* private mode */
    }
  }, [speed]);

  useEffect(() => {
    if (hlsRef.current) hlsRef.current.audioTrack = audio;
  }, [audio]);

  /* a first segment should arrive in a second or two; if it does not, say so */
  useEffect(() => {
    if (!waiting) {
      setSlow(false);
      return;
    }
    const timer = window.setTimeout(() => setSlow(true), 4500);
    return () => window.clearTimeout(timer);
  }, [waiting, sourceIndex, attempt, generation]);

  /* mirror failed into a ref so the stall watchdog (interval) sees it */
  useEffect(() => {
    failedRef.current = failed;
  }, [failed]);

  /* espelha a fonte atual para o watchdog (closure do intervalo) */
  useEffect(() => {
    sourceIndexRef.current = sourceIndex;
  }, [sourceIndex]);
  useEffect(() => {
    playableRef.current = playable;
  }, [playable]);

  /** reload the same source at the last known position (stall recovery) */
  const recoverStall = useCallback(() => {
    const video = videoRef.current;
    /* tudo30: se o elemento já perdeu a posição (currentTime 0/NaN no
       momento da trava), usa a última posição conhecida — nunca 0 no
       meio do filme. */
    const at =
      video && Number.isFinite(video.currentTime) && video.currentTime > 0
        ? video.currentTime
        : lastKnownTime.current;
    if (at > 0) resumeOverride.current = at;
    setGeneration((value) => value + 1);
  }, []);

  /**
   * tudo21: trava no MEIO da reprodução — troca para a PRÓXIMA fonte na
   * posição atual (tudo20 só trocava MP4→HLS porque o MP4 era a 1ª fonte;
   * a troca é genérica: MP4 travou → tenta o HLS; HLS travou → não há
   * próxima, recarrega). No tudo22 o MP4 voltou a ser a 1ª fonte (o
   * painel não serve HLS para VOD). Devolve false se não houver próxima
   * fonte para tentar.
   */
  const switchStallToNext = useCallback(() => {
    const list = playableRef.current;
    const current = list[sourceIndexRef.current];
    const nextIndex = list.findIndex((_entry, i) => i > sourceIndexRef.current);
    if (!current || nextIndex < 0) return false;
    const video = videoRef.current;
    /* tudo30: idem recoverStall — última posição conhecida quando o
       elemento já perdeu a atual. */
    const at =
      video && Number.isFinite(video.currentTime) && video.currentTime > 0
        ? video.currentTime
        : lastKnownTime.current;
    if (at > 0) resumeOverride.current = at;
    trialRef.current = { from: sourceIndexRef.current, to: nextIndex };
    setAttempt(0);
    setSourceIndex(nextIndex);
    setGeneration((value) => value + 1);
    return true;
  }, []);

  /**
   * Mid-playback stall watchdog (tudo20, generalizado no tudo21): se
   * currentTime congela ~8s enquanto o vídeo deveria tocar, a 1ª vez
   * recarrega a mesma fonte na última posição; na 2ª trava troca para a
   * OUTRA fonte (MP4 travou → HLS; HLS travou → não há outra, recarrega).
   * Até 3 recuperações automáticas, com 15s de cooldown entre elas;
   * depois disso, mostra a tela de falha.
   */
  useEffect(() => {
    const id = window.setInterval(() => {
      const video = videoRef.current;
      if (!video || failedRef.current) return;
      if (video.paused || video.ended) {
        stallRef.current.stalledSince = null;
        return;
      }
      const now = Date.now();
      if (now < stallRef.current.cooldownUntil) return;
      if (video.currentTime > 0) {
        stallRef.current.hasPlayed = true;
        lastKnownTime.current = video.currentTime;
      }
      if (!stallRef.current.hasPlayed) return;
      if (Math.abs(video.currentTime - stallRef.current.lastTime) > 0.05) {
        stallRef.current.lastTime = video.currentTime;
        stallRef.current.stalledSince = null;
        return;
      }
      if (stallRef.current.stalledSince === null) {
        stallRef.current.stalledSince = now;
        return;
      }
      if (now - stallRef.current.stalledSince >= 8_000) {
        if (stallRef.current.recoveries < 3) {
          stallRef.current.recoveries += 1;
          stallRef.current.stalledSince = null;
          stallRef.current.cooldownUntil = now + 15_000;
          /* 2ª trava em diante: tenta a OUTRA fonte (segmentada, com
             retry). Se não houver outra, recarrega a mesma fonte. */
          if (stallRef.current.recoveries >= 2 && switchStallToNext()) {
            return;
          }
          recoverStall();
        } else {
          stallRef.current.stalledSince = null;
          failedRef.current = true;
          setFailed(true);
          onErrorRef.current?.();
        }
      }
    }, 2000);
    return () => window.clearInterval(id);
  }, [recoverStall, switchStallToNext]);

  /* user picks a quality / caption track → apply it to the engine */
  useEffect(() => {
    if (!hlsRef.current) return;
    /* -1 = Auto: give control back to ABR instead of pinning the rendition we
       happened to start on (which is what froze every title at 640x266) */
    hlsRef.current.currentLevel = level;
    if (level === -1) hlsRef.current.nextLevel = -1;
  }, [level]);

  useEffect(() => {
    if (!hlsRef.current) return;
    hlsRef.current.subtitleTrack = caption;
  }, [caption]);

  /* Netflix-style end card: offer the next episode during the last 25s */
  useEffect(() => {
    if (!onNext || !duration) {
      setNextIn(null);
      return;
    }
    const left = duration - time;
    if (left > 25 || left < 0) {
      setNextIn(null);
      return;
    }
    setNextIn(Math.max(0, Math.ceil(left)));
  }, [duration, time, onNext]);

  useEffect(() => {
    if (nextIn !== 0 || nextFired.current || !onNext) return;
    nextFired.current = true;
    onNext();
  }, [nextIn, onNext]);

  useEffect(() => {
    nextFired.current = false;
    setNextIn(null);
  }, [sourceKey]);

  /* ---------------------------------------------------------------- controls */

  const poke = useCallback(() => {
    setChrome(true);
    if (hideTimer.current) window.clearTimeout(hideTimer.current);
    hideTimer.current = window.setTimeout(() => setChrome(false), 2800);
  }, []);

  useEffect(() => {
    poke();
    return () => {
      if (hideTimer.current) window.clearTimeout(hideTimer.current);
    };
  }, [poke]);

  const toggle = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    ensureAudioBoost();
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }, [ensureAudioBoost]);

  const seekBy = useCallback((delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.min(Math.max(video.currentTime + delta, 0), video.duration || 0);
  }, []);

  const seekTo = useCallback((ratio: number) => {
    const video = videoRef.current;
    if (!video || !Number.isFinite(video.duration)) return;
    video.currentTime = Math.max(0, Math.min(1, ratio)) * video.duration;
  }, []);

  const toggleMute = useCallback(() => {
    const video = videoRef.current;
    if (!video) return;
    ensureAudioBoost();
    video.muted = !video.muted;
    if (!video.muted && volume === 0) setVolume(2);
  }, [ensureAudioBoost, volume]);

  const toggleFullscreen = useCallback(() => {
    const shell = shellRef.current;
    if (!shell) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    else void shell.requestFullscreen?.().catch(() => undefined);
  }, []);

  const togglePip = useCallback(async () => {
    const video = videoRef.current;
    if (!video) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch {
      /* unsupported */
    }
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      switch (event.key.toLowerCase()) {
        case " ":
        case "k":
          event.preventDefault();
          toggle();
          break;
        case "arrowright":
          seekBy(10);
          poke();
          break;
        case "arrowleft":
          seekBy(-10);
          poke();
          break;
        case "f":
          toggleFullscreen();
          break;
        case "m":
          toggleMute();
          break;
        case "j":
          seekBy(-10);
          poke();
          break;
        case "l":
          seekBy(10);
          poke();
          break;
        case "arrowup":
          event.preventDefault();
          setVolume((v) => Math.min(4, Math.round((v + 0.1) * 100) / 100));
          poke();
          break;
        case "arrowdown":
          event.preventDefault();
          setVolume((v) => Math.max(0, Math.round((v - 0.1) * 100) / 100));
          poke();
          break;
        case "escape":
          if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [poke, seekBy, toggle, toggleFullscreen, toggleMute]);

  /** start the whole chain again — sources change, tokens expire, CDNs blink */
  const retryAll = useCallback(() => {
    nextFired.current = false;
    setFailed(false);
    failedRef.current = false;
    resumeOverride.current = null;
    stallRef.current = {
      lastTime: 0,
      stalledSince: null,
      recoveries: 0,
      hasPlayed: false,
      cooldownUntil: 0,
    };
    setSourceIndex(0);
    setAttempt(0);
    setGeneration((value) => value + 1);
  }, []);

  /**
   * One surface for taps: a second tap inside 320ms on the left/right third is
   * a double-tap seek (how Netflix behaves on a phone), anything else is
   * play/pause after a short wait so the two do not fight.
   */
  const onSurfaceTap = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      const x = event.clientX - rect.left;
      const now = Date.now();
      const doubled = now - tap.current.at < 320 && Math.abs(x - tap.current.x) < 140;

      if (doubled) {
        window.clearTimeout(tap.current.timer);
        tap.current = { at: 0, x, timer: 0 };
        const back = x < rect.width * 0.38;
        seekBy(back ? -10 : 10);
        setFlash(back ? "back" : "forward");
        window.setTimeout(() => setFlash(null), 520);
        return;
      }

      tap.current.at = now;
      tap.current.x = x;
      tap.current.timer = window.setTimeout(() => {
        toggle();
        poke();
      }, 250);
    },
    [poke, seekBy, toggle],
  );

  const scrub = (event: React.PointerEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    seekTo((event.clientX - rect.left) / rect.width);
  };

  const progress = duration > 0 ? (time / duration) * 100 : 0;
  const bufferedPct = duration > 0 ? Math.min(100, (buffered / duration) * 100) : 0;

  return (
    <div
      ref={shellRef}
      onMouseMove={poke}
      onTouchStart={poke}
      className="group absolute inset-0 z-20 bg-black text-white"
    >
      <video
        ref={videoEl}
        playsInline
        preload="auto"
        poster={poster}
        className="h-full w-full bg-black object-contain"
      />

      {/* taps: play/pause, or double-tap either side to jump 10s */}
      <div className="absolute inset-0 z-10" onPointerUp={onSurfaceTap} />

      {flash && (
        <div
          className={cn(
            "pointer-events-none absolute inset-y-0 z-20 grid w-1/3 place-items-center bg-white/10",
            flash === "back" ? "left-0 rounded-r-full" : "right-0 rounded-l-full",
          )}
        >
          <span className="flex items-center gap-1 text-[13px] font-semibold text-white/90">
            {flash === "back" ? <RewindIcon width={18} height={18} /> : <ForwardIcon width={18} height={18} />}10s
          </span>
        </div>
      )}

      {/* buffering */}
      {waiting && !failed && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
          <div className="flex flex-col items-center gap-3">
            <span className="h-10 w-10 animate-spin rounded-full border-2 border-white/25 border-t-[var(--nf-accent)]" />
            {slow && (
              <p className="text-[12px] font-medium text-white/60">
                Conectando ao {playable[sourceIndex]?.label ?? "stream"}…
              </p>
            )}
          </div>
        </div>
      )}

      {/* fatal: every source refused */}
      {failed && (
        <div className="absolute inset-0 grid place-items-center bg-black/85 px-6 text-center">
          <div>
            <p className="text-[15px] font-semibold">Este título não começou no player CinePlus</p>
            <p className="mt-1 text-[12.5px] text-white/55">
              {isPanel
                ? "Tente novamente — se persistir, confira o painel."
                : "Troque de servidor no menu — os embeds continuam lá."}
            </p>
            <div className="mt-4 flex items-center justify-center gap-2">
              <button
                type="button"
                onClick={retryAll}
                className="rounded-full bg-white px-4 py-2 text-[12.5px] font-semibold text-black"
              >
                Tentar novamente
              </button>
              {!isPanel && (
                <button
                  type="button"
                  onClick={() => onError?.()}
                  className="rounded-full bg-white/15 px-4 py-2 text-[12.5px] font-semibold text-white"
                >
                  Servidor de reserva
                </button>
              )}
            </div>
            {/* tudo29: avisar o dono que este título não tocou — só aparece
                quando o Telegram está configurado no admin; depois do clique
                vira "Aviso enviado ✓" (1 por título por sessão). */}
            {report && (
              <div className="mt-3 flex justify-center">
                <ReportBrokenButton info={report} enabled={report.enabled} />
              </div>
            )}
            <p className="mt-2 text-[11px] text-white/35">
              {playable.length} source{playable.length === 1 ? "" : "s"} tried ·{" "}
              {playable.map((entry) => entry.label).join(", ") || "none available"}
            </p>
          </div>
        </div>
      )}

      {/* centre play affordance (the tap surface owns the click) */}
      {!playing && !waiting && !failed && (
        <div className="pointer-events-none absolute inset-0 z-20 grid place-items-center">
          <span className="grid h-16 w-16 place-items-center rounded-full bg-black/55 ring-2 ring-white/70 backdrop-blur-sm">
            <PlayIcon width={22} height={22} />
          </span>
        </div>
      )}

      {/* skip intro */}
      {playing && time > 5 && time < 95 && (
        <button
          type="button"
          onClick={() => {
            seekBy(85);
            poke();
          }}
          className="absolute bottom-24 right-4 z-30 rounded-md bg-white/90 px-3.5 py-2 text-[12px] font-semibold text-black shadow-lg transition hover:bg-white md:right-6"
        >
          Pular introdução
        </button>
      )}

      {/* next episode card, like the real thing */}
      {nextIn !== null && onNext && !failed && (
        <div className="absolute bottom-24 right-4 z-30 w-[228px] rounded-lg border border-white/10 bg-[#0f1220]/95 p-3 shadow-2xl backdrop-blur-xl md:right-6">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">
            {nextIn > 0 ? `Próximo episódio em ${nextIn}` : "Próximo episódio"}
          </p>
          <p className="mt-1 truncate text-[13px] font-semibold">{nextLabel ?? "A seguir"}</p>
          <div className="mt-2.5 flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                nextFired.current = true;
                onNext();
              }}
              className="flex-1 rounded-md bg-white px-3 py-1.5 text-[12px] font-semibold text-black"
            >
              Assistir agora
            </button>
            <button
              type="button"
              onClick={() => {
                nextFired.current = true;
                setNextIn(null);
              }}
              className="rounded-md bg-white/10 px-3 py-1.5 text-[12px] font-semibold text-white/80"
            >
              Cancelar
            </button>
          </div>
        </div>
      )}

      {/* chrome */}
      <div
        className={cn(
          "pointer-events-none absolute inset-x-0 bottom-0 z-30 bg-gradient-to-t from-black/85 via-black/35 to-transparent px-3 pb-3 pt-12 transition-opacity duration-200 md:px-5 md:pb-4",
          chrome ? "opacity-100" : "opacity-0",
        )}
      >
        <div className="pointer-events-auto">
          {/* seek bar */}
          <div
            role="slider"
            aria-label="Buscar posição"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress)}
            tabIndex={0}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture(event.pointerId);
              scrub(event);
            }}
            onPointerMove={(event) => {
              if (event.buttons === 1) scrub(event);
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowRight") seekBy(10);
              if (event.key === "ArrowLeft") seekBy(-10);
            }}
            className="group/seek relative h-4 cursor-pointer touch-none select-none"
          >
            <span className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/25" />
            <span
              className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/40"
              style={{ width: `${bufferedPct}%` }}
            />
            <span
              className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[var(--nf-accent)]"
              style={{ width: `${progress}%` }}
            />
            <span
              className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[var(--nf-accent)] opacity-0 transition group-hover/seek:opacity-100"
              style={{ left: `${progress}%` }}
            />
          </div>

          <div className="mt-1.5 flex items-center gap-1.5 md:gap-2.5">
            <button type="button" onClick={() => seekBy(-10)} aria-label="Back 10 seconds" className="p-1.5 text-white/85 hover:text-white">
              <RewindIcon width={17} height={17} />
            </button>
            <button type="button" onClick={toggle} aria-label={playing ? "Pausar" : "Assistir"} className="p-1.5 text-white hover:text-white/80">
              {playing ? <PauseIcon width={19} height={19} /> : <PlayIcon width={19} height={19} />}
            </button>
            <button type="button" onClick={() => seekBy(10)} aria-label="Avançar 10 segundos" className="p-1.5 text-white/85 hover:text-white">
              <ForwardIcon width={17} height={17} />
            </button>

            <div className="ml-1 flex items-center gap-1.5">
              <button type="button" onClick={toggleMute} aria-label={muted ? "Ativar som" : "Silenciar"} className="p-1.5 text-white/85 hover:text-white">
                {muted || volume === 0 ? <MuteIcon width={17} height={17} /> : <VolumeIcon width={17} height={17} />}
              </button>
              <input
                type="range"
                min={0}
                max={4}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(event) => {
                  const video = videoRef.current;
                  if (!video) return;
                  const next = Number(event.target.value);
                  ensureAudioBoost();
                  setVolume(next);
                  video.muted = next === 0;
                }}
                aria-label="Volume"
                className="hidden h-1 w-16 cursor-pointer appearance-none rounded-full bg-white/30 accent-white sm:block"
              />
            </div>

            <span className="ml-1 text-[11.5px] tabular-nums text-white/70">
              {fmt(time)} <span className="text-white/35">/ {fmt(duration)}</span>
            </span>

            <div className="ml-auto flex items-center gap-1">
              {/* source switch */}
              {playable.length > 1 && (
                <MenuButton
                  label="Fonte"
                  active={menu === "source"}
                  onClick={() => setMenu(menu === "source" ? null : "source")}
                  text={playable[sourceIndex]?.label ?? "Fonte"}
                  chrome={chrome}
                  panel={
                    <Panel>
                      {playable.map((entry, index) => (
                        <Option
                          key={`${entry.url}-${index}`}
                          active={index === sourceIndex}
                          onClick={() => {
                            setSourceIndex(index);
                            setAttempt(0);
                            setMenu(null);
                          }}
                        >
                          {entry.label} {entry.quality ? `· ${entry.quality}` : ""}
                          {entry.codec === "hevc" ? " · HDR/HEVC" : ""}
                        </Option>
                      ))}
                    </Panel>
                  }
                />
              )}

              {/* captions */}
              {captionTracks.length > 0 && (
                <MenuButton
                  icon={<SubtitlesIcon width={17} height={17} />}
                  label="Legendas"
                  active={menu === "captions"}
                  onClick={() => setMenu(menu === "captions" ? null : "captions")}
                  chrome={chrome}
                  panel={
                    <Panel>
                      <Option
                        active={caption === -1}
                        onClick={() => {
                          if (videoRef.current) videoRef.current.textTracks[0] && (videoRef.current.textTracks[0].mode = "disabled");
                          setCaption(-1);
                          setMenu(null);
                        }}
                      >
                        Off
                      </Option>
                      {captionTracks.map((track) => (
                        <Option
                          key={track.index}
                          active={caption === track.index}
                          onClick={() => {
                            setCaption(track.index);
                            setMenu(null);
                          }}
                        >
                          {track.label}
                        </Option>
                      ))}
                    </Panel>
                  }
                />
              )}

              {/* quality */}
              {levels.length > 1 && (
                <MenuButton
                  label="Qualidade"
                  active={menu === "quality"}
                  onClick={() => setMenu(menu === "quality" ? null : "quality")}
                  text={
                    level >= 0
                      ? levels.find((entry) => entry.index === level)?.label ?? "Automático"
                      : activeLevel >= 0
                        ? `Auto · ${levels.find((entry) => entry.index === activeLevel)?.label ?? ""}`.trim()
                        : "Automático"
                  }
                  chrome={chrome}
                  panel={
                    <Panel>
                      <Option
                        active={level === -1}
                        onClick={() => {
                          if (hlsRef.current) hlsRef.current.currentLevel = -1;
                          setLevel(-1);
                          setMenu(null);
                        }}
                      >
                        Auto
                        {activeLevel >= 0
                          ? ` · ${levels.find((entry) => entry.index === activeLevel)?.label ?? ""}`
                          : ""}
                      </Option>
                      {[...levels].reverse().map((entry) => (
                        <Option
                          key={entry.index}
                          active={level === entry.index}
                          onClick={() => {
                            setLevel(entry.index);
                            setMenu(null);
                          }}
                        >
                          {entry.label}
                        </Option>
                      ))}
                    </Panel>
                  }
                />
              )}

              {/* audio track */}
              {audioTracks.length > 1 && (
                <MenuButton
                  label="Áudio"
                  active={menu === "audio"}
                  onClick={() => setMenu(menu === "audio" ? null : "audio")}
                  text={audioTracks.find((entry) => entry.index === audio)?.label ?? "Áudio"}
                  chrome={chrome}
                  panel={
                    <Panel>
                      {audioTracks.map((track) => (
                        <Option
                          key={track.index}
                          active={audio === track.index}
                          onClick={() => {
                            setAudio(track.index);
                            setMenu(null);
                          }}
                        >
                          {track.label}
                        </Option>
                      ))}
                    </Panel>
                  }
                />
              )}

              {/* playback speed */}
              <MenuButton
                label="Velocidade de reprodução"
                active={menu === "speed"}
                onClick={() => setMenu(menu === "speed" ? null : "speed")}
                text={speed === 1 ? "1x" : `${speed}x`}
                chrome={chrome}
                panel={
                  <Panel>
                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((value) => (
                      <Option
                        key={value}
                        active={speed === value}
                        onClick={() => {
                          setSpeed(value);
                          setMenu(null);
                        }}
                      >
                        {value === 1 ? "Normal" : `${value}x`}
                      </Option>
                    ))}
                  </Panel>
                }
              />

              <button type="button" onClick={() => void togglePip()} aria-label="Imagem em imagem" className="hidden p-1.5 text-white/85 hover:text-white sm:block">
                <PiPIcon />
              </button>
              <button type="button" onClick={toggleFullscreen} aria-label="Tela cheia" className="p-1.5 text-white/85 hover:text-white">
                <FullscreenIcon width={17} height={17} />
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* tudo25: chip "CinePlus Player" + título REMOVIDO — ele ficava no
         mesmo canto superior esquerdo que o pill "Você está assistindo"
         do Player e os dois se sobrepunham (o "CINEPLUS" por cima do
         título e o fragmento "/ 3" solto). O pill do Player já mostra
         o título limpo; o NativePlayer não precisa repetir. */}
    </div>
  );
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div className="absolute bottom-11 right-0 z-40 max-h-[46vh] w-[210px] overflow-y-auto overscroll-contain rounded-lg border border-white/10 bg-[#0f1220]/[0.98] p-1 shadow-2xl backdrop-blur-xl">
      {children}
    </div>
  );
}

function Option({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] transition hover:bg-white/10",
        active ? "text-white" : "text-white/70",
      )}
    >
      <span className="truncate">{children}</span>
      {active && <span className="h-1.5 w-1.5 rounded-full bg-[var(--nf-accent)]" />}
    </button>
  );
}

function MenuButton({
  label,
  text,
  icon,
  active,
  onClick,
  panel,
}: {
  label: string;
  text?: string;
  icon?: React.ReactNode;
  active: boolean;
  onClick: () => void;
  panel: React.ReactNode;
  chrome?: boolean;
}) {
  return (
    <div className="relative">
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        className={cn(
          "flex items-center gap-1 rounded px-1.5 py-1 text-[11.5px] font-medium transition",
          active ? "bg-white/20 text-white" : "text-white/80 hover:text-white",
        )}
      >
        {icon ?? text ?? label}
        <ChevronDownIcon width={11} height={11} />
      </button>
      {active && panel}
    </div>
  );
}

function PiPIcon() {
  return (
    <svg width={17} height={17} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8}>
      <rect x="3" y="5" width="18" height="14" rx="2" />
      <rect x="12" y="12" width="7" height="5" rx="1" fill="currentColor" stroke="none" />
    </svg>
  );
}
