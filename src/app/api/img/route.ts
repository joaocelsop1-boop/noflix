import { NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { TMDB_API_KEY, isBearerToken } from "@/lib/tmdb-key";

/**
 * GET /api/img?u=<artwork url>&alt=<backup url>
 *
 * Poster and backdrop proxy.
 *
 * Artwork used to be loaded straight from image.tmdb.org / images.metahub.space
 * by the visitor's browser. Two things went wrong with that: a host that
 * *hangs* (rather than erroring) leaves the <img> in limbo — no `load`, no
 * `error`, so the tile stays invisible forever — and a host blocked at the
 * visitor's ISP takes the art down with it. Both are solved by fetching the
 * bytes here, with a hard timeout, and serving them from our own origin.
 *
 * `alt` is tried when `u` fails, so a title with both a TMDB path and an IMDb
 * id still has a second chance before the UI falls back to its gradient plate.
 *
 * `?tmdb=<id>&kind=poster|backdrop` resolves artwork from TMDB by id instead.
 * That is the most dependable path — several bundled titles only carried an
 * IMDb id, so their art came from a third-party CDN that is often down; TMDB
 * almost always has a real still for the same title.
 */

/**
 * As capas do painel vêm de muitos hosts (o provedor troca de CDN com
 * frequência: fenix7, ibb, imgur, cplay, ...). Uma lista fechada de hosts
 * derrubava centenas de capas — por isso alguns filmes mostravam a imagem e
 * outros não. Em vez de lista fechada, bloqueamos só o que é interno/privado
 * (localhost, rede local, IP reservado); qualquer host público é aceito. O
 * risco de SSRF é contido porque `grab()` só devolve o corpo quando o
 * content-type é imagem, e o timeout é de 6s.
 */
const BLOCKED_HOST_SUFFIXES = [".local", ".internal", ".lan", ".home", ".corp", ".intranet"];

function isPrivateHost(hostname: string): boolean {
  const h = hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost")) return true;
  if (BLOCKED_HOST_SUFFIXES.some((s) => h.endsWith(s))) return true;
  // IP literal em faixa privada/reservada
  if (/^(10|127|172\.(1[6-9]|2\d|3[01])|192\.168|169\.254)\./.test(h)) return true;
  if (h === "::1" || h.startsWith("fe80:") || h.startsWith("fd") || h.startsWith("fc")) return true;
  return false;
}

/** Six seconds is plenty for a CDN edge, and short enough to fail visibly. */
const TIMEOUT_MS = 6000;

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36";

/** resolved TMDB artwork paths, kept for a day */
const resolved = new Map<string, { at: number; path: string | null }>();
const DAY = 86_400_000;

/**
 * Cache negativo (10 min): uma capa morta (fenix7 404, slackewn 403) não
 * precisa ser buscada de novo a cada abertura da inicial — a segunda vez
 * falha na hora, sem esperar o timeout da rede segurar a fileira.
 */
const NEGATIVE_TTL = 10 * 60 * 1000;
const dead = new Map<string, number>();

function isDead(url: string): boolean {
  const at = dead.get(url);
  if (at === undefined) return false;
  if (Date.now() - at > NEGATIVE_TTL) {
    dead.delete(url);
    return false;
  }
  return true;
}

function markDead(url: string): void {
  if (dead.size >= 2000) dead.clear();
  dead.set(url, Date.now());
}

/**
 * Cache positivo em memória (1h, até 150 capas / 48 MB): a capa buscada uma
 * vez não volta ao host de origem — a inicial abre rápido na segunda visita
 * e para outros usuários, sem depender só do cache do navegador. O negativo
 * (capa morta, 10 min) já existia; faltava o positivo, e era ele que deixava
 * a inicial lenta: cada abertura re-buscava todas as capas nos hosts lentos
 * do painel. FIFO quando cheio; TTL de 1h por entrada.
 */
const IMG_TTL = 60 * 60 * 1000;
const IMG_MAX_ENTRIES = 400;
const IMG_MAX_BYTES = 128 * 1024 * 1024;
const imgCache = new Map<string, { at: number; type: string; body: Uint8Array<ArrayBuffer>; size: number }>();
let imgCacheBytes = 0;

function imgCacheGet(url: string): { type: string; body: Uint8Array<ArrayBuffer> } | null {
  const hit = imgCache.get(url);
  if (!hit) return null;
  if (Date.now() - hit.at > IMG_TTL) {
    imgCache.delete(url);
    imgCacheBytes -= hit.size;
    return null;
  }
  return { type: hit.type, body: hit.body };
}

function imgCacheSet(url: string, type: string, body: Uint8Array<ArrayBuffer>): void {
  const size = body.byteLength;
  if (size <= 0 || size > IMG_MAX_BYTES) return;
  const prev = imgCache.get(url);
  if (prev) imgCacheBytes -= prev.size;
  while (
    (imgCache.size >= IMG_MAX_ENTRIES || imgCacheBytes + size > IMG_MAX_BYTES) &&
    imgCache.size > 0
  ) {
    const oldest = imgCache.keys().next();
    if (oldest.done) break;
    const victim = imgCache.get(oldest.value);
    if (victim) imgCacheBytes -= victim.size;
    imgCache.delete(oldest.value);
  }
  imgCache.set(url, { at: Date.now(), type, body, size });
  imgCacheBytes += size;
}

/**
 * Cache em disco (tudo13): o cache em memória some a cada redeploy/restart
 * do Coolify, e a primeira carga de cada capa voltava aos hosts lentos do
 * painel (fenix7/slackewn, muitos 404/403, timeout de 6s). As capas buscadas
 * com sucesso também são gravadas em disco — "puxa do meu servidor" — numa
 * pasta montada num volume nomeado no docker-compose, então sobrevive a
 * redeploys. TTL de 7 dias; poda FIFO quando passar de ~500 MB ou ~2000
 * arquivos. Falha de disco nunca quebra o atendimento: cai para
 * memória/rede. Só sucessos vão para o disco; o cache negativo (capa morta)
 * continua só em memória.
 */
const DISK_TTL = 7 * 24 * 60 * 60 * 1000;
const DISK_MAX_FILES = 2000;
const DISK_MAX_BYTES = 500 * 1024 * 1024;
const DISK_DIR = process.env.IMG_CACHE_DIR ?? path.join(process.cwd(), ".img-cache");

const EXT_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/avif": "avif",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};
const TYPE_BY_EXT: Record<string, string> = Object.fromEntries(
  Object.entries(EXT_BY_TYPE).map(([type, ext]) => [ext, type]),
);

function diskKey(url: string, type: string): string | null {
  const ext = EXT_BY_TYPE[type.split(";")[0].trim().toLowerCase()];
  if (!ext) return null;
  return `${createHash("sha256").update(url).digest("hex")}.${ext}`;
}

let diskDirReady = false;
async function ensureDiskDir(): Promise<boolean> {
  if (diskDirReady) return true;
  try {
    await fs.mkdir(DISK_DIR, { recursive: true });
    diskDirReady = true;
    return true;
  } catch {
    return false;
  }
}

async function diskCacheGet(
  url: string,
): Promise<{ type: string; body: Uint8Array<ArrayBuffer> } | null> {
  try {
    // O arquivo é <sha256>.<ext> — testa as extensões direto, sem listar a
    // pasta. Antes cada capa fazia um readdir (até 2000 arquivos) para
    // achar o seu: com 150 capas na inicial, 150 varreduras por abertura.
    const hash = createHash("sha256").update(url).digest("hex");
    for (const ext of ["jpg", "png", "webp", "avif", "gif", "svg"]) {
      const file = path.join(DISK_DIR, `${hash}.${ext}`);
      try {
        const stat = await fs.stat(file);
        if (Date.now() - stat.mtimeMs > DISK_TTL) {
          await fs.unlink(file).catch(() => undefined);
          continue;
        }
        const buf = await fs.readFile(file);
        const type = TYPE_BY_EXT[ext] ?? "image/jpeg";
        return { type, body: new Uint8Array(buf) };
      } catch {
        /* tenta a próxima extensão */
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function diskCacheSet(url: string, type: string, body: Uint8Array<ArrayBuffer>): Promise<void> {
  try {
    const name = diskKey(url, type);
    if (!name) return;
    if (!(await ensureDiskDir())) return;
    await fs.writeFile(path.join(DISK_DIR, name), body);
    await pruneDiskCache();
  } catch {
    /* disco indisponível: o cache em memória continua valendo */
  }
}

/** Poda no máximo 1x a cada 10 min: antes ela rodava a cada capa gravada e
 * varria a pasta inteira (readdir + stat de até 2000 arquivos) por capa —
 * na 1ª carga da inicial, 150 podas. */
let lastPruneAt = 0;
const PRUNE_MIN_INTERVAL = 10 * 60 * 1000;

async function pruneDiskCache(): Promise<void> {
  const now = Date.now();
  if (now - lastPruneAt < PRUNE_MIN_INTERVAL) return;
  lastPruneAt = now;
  try {
    const names = await fs.readdir(DISK_DIR);
    const infos: Array<{ name: string; mtimeMs: number; size: number }> = [];
    let total = 0;
    for (const name of names) {
      try {
        const st = await fs.stat(path.join(DISK_DIR, name));
        if (!st.isFile()) continue;
        infos.push({ name, mtimeMs: st.mtimeMs, size: st.size });
        total += st.size;
      } catch {
        /* some */
      }
    }
    if (infos.length === 0) return;
    const now = Date.now();
    infos.sort((a, b) => a.mtimeMs - b.mtimeMs);
    let count = infos.length;
    for (const info of infos) {
      const expired = now - info.mtimeMs > DISK_TTL;
      if (!expired && count <= DISK_MAX_FILES && total <= DISK_MAX_BYTES) break;
      await fs.unlink(path.join(DISK_DIR, info.name)).catch(() => undefined);
      count -= 1;
      total -= info.size;
    }
  } catch {
    /* poda é best-effort */
  }
}

function tmdbKey(): string {
  return (
    process.env.TMDB_API_KEY ??
    process.env.NEXT_PUBLIC_TMDB_API_KEY ??
    TMDB_API_KEY ??
    ""
  ).trim();
}

async function fromTmdb(id: string, kind: "poster" | "backdrop"): Promise<string | null> {
  if (!/^\d+$/.test(id)) return null;
  const cacheKey = `${kind}:${id}`;
  const hit = resolved.get(cacheKey);
  if (hit && Date.now() - hit.at < DAY) return hit.path;

  const credential = tmdbKey();
  if (!credential) return null;
  const bearer = isBearerToken(credential);

  for (const type of ["movie", "tv"]) {
    const url = new URL(`https://api.themoviedb.org/3/${type}/${id}`);
    url.searchParams.set("language", "en-US");
    if (!bearer) url.searchParams.set("api_key", credential);
    try {
      const res = await fetch(url, {
        headers: bearer ? { authorization: `Bearer ${credential}` } : undefined,
        signal: AbortSignal.timeout(TIMEOUT_MS),
        next: { revalidate: DAY / 1000 },
      });
      if (!res.ok) continue;
      const data = (await res.json()) as {
        poster_path?: string | null;
        backdrop_path?: string | null;
      };
      const path = kind === "poster" ? data.poster_path : data.backdrop_path ?? data.poster_path;
      if (path) {
        const full = `https://image.tmdb.org/t/p/${kind === "poster" ? "w500" : "w1280"}${path}`;
        resolved.set(cacheKey, { at: Date.now(), path: full });
        return full;
      }
    } catch {
      /* try the other media type */
    }
  }
  resolved.set(cacheKey, { at: Date.now(), path: null });
  return null;
}

function parse(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (isPrivateHost(url.hostname)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

async function grab(target: string): Promise<Response | null> {
  const cached = imgCacheGet(target);
  if (cached) {
    return new NextResponse(cached.body, {
      headers: {
        "content-type": cached.type,
        "cache-control": "public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400",
        "x-artwork-source": new URL(target).hostname,
        "x-artwork-cache": "hit",
      },
    });
  }
  const onDisk = await diskCacheGet(target);
  if (onDisk) {
    imgCacheSet(target, onDisk.type, onDisk.body);
    return new NextResponse(onDisk.body, {
      headers: {
        "content-type": onDisk.type,
        "cache-control": "public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400",
        "x-artwork-source": new URL(target).hostname,
        "x-artwork-cache": "disk",
      },
    });
  }
  try {
    const upstream = await fetch(target, {
      headers: { "user-agent": UA, accept: "image/avif,image/webp,image/*,*/*" },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      /* artwork never changes for a given id — let the CDN keep it a week */
      next: { revalidate: 604_800 },
    });
    if (!upstream.ok || !upstream.body) return null;
    const type = upstream.headers.get("content-type") ?? "";
    if (!type.startsWith("image/")) return null;
    const body = new Uint8Array(await upstream.arrayBuffer());
    imgCacheSet(target, type, body);
    await diskCacheSet(target, type, body);
    return new NextResponse(body, {
      headers: {
        "content-type": type,
        "cache-control": "public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400",
        "x-artwork-source": new URL(target).hostname,
      },
    });
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const kind = searchParams.get("kind") === "poster" ? "poster" : "backdrop";
  const byId = searchParams.get("tmdb");
  const candidates = [
    byId ? await fromTmdb(byId, kind) : null,
    parse(searchParams.get("u")),
    parse(searchParams.get("alt")),
  ].filter((value): value is string => Boolean(value));

  const probe = searchParams.get("probe") === "1";

  for (const candidate of candidates) {
    if (isDead(candidate)) continue;
    const hit = await grab(candidate);
    if (hit) {
      if (!probe) return hit;
      return NextResponse.json({
        ok: true,
        source: hit.headers.get("x-artwork-source"),
        resolved: candidates,
        contentType: hit.headers.get("content-type"),
      });
    }
    markDead(candidate);
  }

  if (probe) {
    return NextResponse.json({ ok: false, resolved: candidates });
  }

  /* a short cache: a hiccup on the CDN should be retried soon, not remembered */
  return new NextResponse(null, {
    status: 404,
    headers: { "cache-control": "public, max-age=60" },
  });
}
