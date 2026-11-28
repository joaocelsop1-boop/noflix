/**
 * Camada TMDB de EXIBIÇÃO (server-only) — tudo24.
 *
 * O catálogo e os streams continuam vindo do painel Xtream (nunca trocar o
 * catálogo para o TMDB — armadilha do tudo15). O TMDB entra só para deixar
 * a exibição igual à demonstração aprovada: capa, backdrop, sinopse, nota,
 * gêneros e duração dos títulos do painel.
 *
 *   dado um título do painel + ano → limpa o nome → busca no TMDB
 *   (/search/movie ou /search/tv) → pega o melhor match (título + ano)
 *   → devolve poster/backdrop/overview/nota/gêneros (+ duração, se pedido).
 *
 * Regras:
 *   • PREGUIÇOSO: só resolve o que a rota /api/tmdb-resolve pedir (o que
 *     está na tela). Nunca em lote para os 31 mil títulos.
 *   • CACHE: memória (500) + disco (.tmdb-cache/, 7 dias) — o mesmo título
 *     não volta ao TMDB. Negativo (sem match) também é cacheado.
 *   • FAIL OPEN: sem chave, sem match ou TMDB fora → null. A tela usa os
 *     dados do painel. Nunca quebra a página.
 *   • CONCORRÊNCIA: no máximo 6 buscas ao TMDB ao mesmo tempo (o limite é
 *     40 req/10s; com cache, o 2º carregamento não chama nada).
 *
 * A chave vem de TMDB_API_KEY (env, já no Coolify) — aceita chave v3 (32
 * chars) ou token v4 (bearer, começa com "eyJ"), igual ao /api/img.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { cleanTitle } from "@/lib/title-clean";
import { TMDB_API_KEY, isBearerToken } from "@/lib/tmdb-key";
import type { TmdbCastMember, TmdbMeta, TmdbRef } from "@/lib/tmdb-types";

const TMDB_API = "https://api.themoviedb.org/3";
const CACHE_DIR = path.join(process.cwd(), ".tmdb-cache");
const CACHE_TTL = 7 * 24 * 60 * 60 * 1000;
const MEM_MAX = 500;
const DISK_MAX_FILES = 2000;
const TIMEOUT_MS = 8000;
const MAX_CONCURRENT = 6;
/** Pontuação mínima (0–110) para aceitar um match do TMDB.
 * tudo25: era 60 — baixo demais, casava o filme errado (pôster de outro
 * título no lugar certo). Com 75, só entra match com título bem próximo
 * E ano compatível. */
export const MIN_SCORE = 75;

/** id de gênero TMDB → nome em português (ids estáveis do TMDB). */
const GENRE_NAME = new Map<number, string>([
  [28, "Ação"],
  [12, "Aventura"],
  [16, "Animação"],
  [35, "Comédia"],
  [80, "Crime"],
  [99, "Documentário"],
  [18, "Drama"],
  [10751, "Família"],
  [14, "Fantasia"],
  [36, "História"],
  [27, "Terror"],
  [10402, "Música"],
  [9648, "Mistério"],
  [10749, "Romance"],
  [878, "Ficção científica"],
  [53, "Suspense"],
  [10752, "Guerra"],
  [37, "Faroeste"],
  [10770, "Filme de TV"],
  [10759, "Ação e Aventura"],
  [10762, "Infantil"],
  [10763, "Notícias"],
  [10764, "Reality"],
  [10765, "Ficção científica e Fantasia"],
  [10766, "Novela"],
  [10767, "Talk Show"],
  [10768, "Guerra e Política"],
]);

function credential(): string {
  return (
    process.env.TMDB_API_KEY ??
    process.env.NEXT_PUBLIC_TMDB_API_KEY ??
    TMDB_API_KEY ??
    ""
  ).trim();
}

/** Normaliza para comparar: minúsculo, sem acento e sem pontuação. */
function norm(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Quão bem o candidato do TMDB casa com o título do painel (0–110).
    Exportado para o teste de lógica (tudo26) — função pura. */
export function scoreMatch(
  query: string,
  queryYear: number | undefined,
  candTitle: string,
  candDate: string | undefined,
): number {
  const t = norm(candTitle);
  const q = norm(query);
  if (!t || !q) return 0;
  let score: number;
  if (t === q) score = 100;
  else if (t.startsWith(q) || q.startsWith(t)) score = 85;
  else if (t.includes(q) || q.includes(t)) score = 70;
  else {
    const qw = q.split(" ").filter((w) => w.length > 2);
    const tw = new Set(t.split(" "));
    const hits = qw.filter((w) => tw.has(w)).length;
    if (qw.length === 0) return 0;
    if (hits === qw.length) score = 65;
    else if (hits > 0) score = 40 + Math.round((hits / qw.length) * 20);
    else return 0;
  }
  /* tudo26: candidato com palavras a mais que a busca é OUTRO título
     ("A Noiva Cadáver" não é "A Noiva!") — mesmo com o ano igual, um
     prefixo/substring com palavra extra não pode passar no MIN_SCORE.
     Capa a pontuação de título em 60 (com o bônus de ano dá 70 < 75). */
  const tWords = new Set(t.split(" ").filter(Boolean));
  const qWords = q.split(" ").filter(Boolean);
  if (
    qWords.length > 0 &&
    qWords.every((w) => tWords.has(w)) &&
    tWords.size > qWords.length &&
    score > 60
  ) {
    score = 60;
  }
  const cy = candDate ? Number(candDate.slice(0, 4)) : NaN;
  if (queryYear && Number.isFinite(cy)) {
    if (cy === queryYear) score += 10;
    else if (Math.abs(cy - queryYear) === 1) score += 3;
    /* tudo25: ano bem diferente é quase certeza de filme errado — pesa
       forte para o match não passar. */
    else if (Math.abs(cy - queryYear) > 2) score -= 40;
  }
  return score;
}

/* Semáforo simples: no máximo MAX_CONCURRENT buscas ao TMDB ao mesmo tempo. */
let inFlight = 0;
const waiters: Array<() => void> = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_CONCURRENT) {
    await new Promise<void>((resolve) => waiters.push(resolve));
  }
  inFlight += 1;
  try {
    return await fn();
  } finally {
    inFlight -= 1;
    const next = waiters.shift();
    if (next) next();
  }
}

type SearchItem = {
  id: number;
  title?: string;
  name?: string;
  original_title?: string;
  original_name?: string;
  poster_path?: string | null;
  backdrop_path?: string | null;
  overview?: string;
  vote_average?: number;
  genre_ids?: number[];
  release_date?: string;
  first_air_date?: string;
};

async function tmdbFetch(
  pathname: string,
  params: Record<string, string>,
  key: string,
): Promise<unknown | null> {
  const url = new URL(`${TMDB_API}${pathname}`);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const bearer = isBearerToken(key);
  if (!bearer) url.searchParams.set("api_key", key);
  try {
    const res = await fetch(url, {
      headers: bearer ? { authorization: `Bearer ${key}` } : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) return null;
    return (await res.json()) as unknown;
  } catch {
    return null;
  }
}

async function searchOnce(
  type: "movie" | "tv",
  query: string,
  year: number | undefined,
  lang: string,
  key: string,
): Promise<SearchItem[]> {
  const params: Record<string, string> = {
    query,
    language: lang,
    page: "1",
    include_adult: "false",
  };
  if (year) {
    // /search/movie usa `year`; /search/tv usa `first_air_date_year`.
    params[type === "movie" ? "year" : "first_air_date_year"] = String(year);
  }
  const data = (await tmdbFetch(`/search/${type}`, params, key)) as {
    results?: SearchItem[];
  } | null;
  return Array.isArray(data?.results) ? data.results : [];
}

async function fetchRuntime(
  id: number,
  type: "movie" | "tv",
  key: string,
): Promise<number | undefined> {
  const data = (await limited(() =>
    tmdbFetch(`/${type}/${id}`, { language: "pt-BR" }, key),
  )) as { runtime?: number; episode_run_time?: number[] } | null;
  if (!data) return undefined;
  if (typeof data.runtime === "number" && data.runtime > 0) return data.runtime;
  const ep = Array.isArray(data.episode_run_time) ? data.episode_run_time[0] : undefined;
  return typeof ep === "number" && ep > 0 ? ep : undefined;
}

/**
 * tudo26: créditos do TMDB -> elenco principal (até 10, em ordem de
 * destaque). Função pura, exportada para o teste de lógica: sem foto ou
 * sem personagem, o membro continua (a tela mostra inicial/nome); sem
 * nome, descarta. Sem elenco, devolve undefined (a seção não aparece).
 */
export function parseCastMembers(
  raw: unknown,
): TmdbCastMember[] | undefined {
  const list = (raw as { cast?: unknown })?.cast;
  if (!Array.isArray(list)) return undefined;
  const out: TmdbCastMember[] = [];
  for (const entry of list) {
    const c = entry as { name?: unknown; character?: unknown; profile_path?: unknown };
    if (typeof c?.name !== "string" || !c.name.trim()) continue;
    out.push({
      name: c.name.trim(),
      character:
        typeof c.character === "string" && c.character.trim()
          ? c.character.trim()
          : undefined,
      photo:
        typeof c.profile_path === "string" && c.profile_path
          ? `https://image.tmdb.org/t/p/w185${c.profile_path}`
          : undefined,
    });
    if (out.length >= 10) break;
  }
  return out.length > 0 ? out : undefined;
}

/**
 * Créditos do TMDB (/movie|tv/{id}/credits) — fail open, com 1 retry.
 * tudo27: `failed` distingue "o TMDB não devolveu nada" (rede/timeout —
 * transitório, vale tentar de novo) de "o título não tem elenco listado"
 * (cast undefined com failed=false — aí o sem-elenco é real e pode ser
 * cacheado). Antes, uma falha transitória caía no mesmo `undefined` e o
 * meta era cacheado SEM elenco por 7 dias — por isso o Elenco aparecia
 * num dia e sumia no outro para o mesmo título.
 */
async function fetchCast(
  id: number,
  type: "movie" | "tv",
  key: string,
): Promise<{ cast?: TmdbCastMember[]; failed: boolean }> {
  for (let attempt = 0; attempt < 2; attempt++) {
    const data = await limited(() =>
      tmdbFetch(`/${type}/${id}/credits`, { language: "pt-BR" }, key),
    );
    if (data) return { cast: parseCastMembers(data), failed: false };
  }
  return { cast: undefined, failed: true };
}

function toMeta(item: SearchItem, runtime?: number, cast?: TmdbCastMember[]): TmdbMeta {
  const title = item.title ?? item.name ?? item.original_title ?? item.original_name ?? "";
  return {
    tmdbId: item.id,
    title,
    poster: item.poster_path ? `https://image.tmdb.org/t/p/w500${item.poster_path}` : undefined,
    backdrop: item.backdrop_path
      ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}`
      : undefined,
    overview: item.overview?.trim() ? item.overview.trim() : undefined,
    rating:
      typeof item.vote_average === "number" && item.vote_average > 0
        ? Math.round(item.vote_average * 10) / 10
        : undefined,
    genres: (item.genre_ids ?? [])
      .map((id) => GENRE_NAME.get(id))
      .filter((g): g is string => Boolean(g))
      .slice(0, 4),
    runtime,
    cast,
    year: Number((item.release_date ?? item.first_air_date ?? "").slice(0, 4)) || undefined,
  };
}

/** Variante de busca sem números no início ("007 Contra GoldenEye" →
 *  "Contra GoldenEye"): o TMDB acha o filme certo, e a pontuação continua
 *  sendo julgada contra o título original limpo. */
function titleVariant(title: string): string {
  return title.replace(/^\d+[\s:.-]+/, "").trim();
}

/**
 * tudo26: a duração do TMDB diverge muito da do arquivo do painel?
 * (mesmo nome, filme errado — ex.: painel diz 126 min, TMDB diz 77 min).
 * Sem duração do painel ou sem runtime do TMDB, não rejeita (fail open).
 * Função pura, exportada para o teste de lógica.
 */
export function runtimeMismatch(
  panelDuration: number | undefined,
  runtime: number | undefined,
): boolean {
  return Boolean(
    panelDuration &&
      runtime &&
      Math.abs(runtime - panelDuration) > 20 &&
      Math.abs(runtime - panelDuration) > panelDuration * 0.25,
  );
}

async function resolveFresh(
  title: string,
  year: number | undefined,
  kind: "movie" | "series",
  details: boolean,
  key: string,
  /* tudo26: duração real do arquivo no painel, em minutos (get_vod_info).
     O painel é a verdade sobre o ARQUIVO: se o match do TMDB tem duração
     muito diferente, é outro filme com o mesmo nome ("A Noiva!" 2025 tem
     126 min; "A Noiva Cadáver" 2005 tem 77 min) — rejeita e tenta a
     próxima tentativa. */
  panelDuration?: number,
): Promise<{ meta: TmdbMeta | null; skipCache?: boolean }> {
  const primary: "movie" | "tv" = kind === "series" ? "tv" : "movie";
  const secondary: "movie" | "tv" = primary === "movie" ? "tv" : "movie";
  // Tentativas em ordem: tipo certo + pt-BR + ano → sem ano → en-US + ano →
  // outro tipo + pt-BR + ano → variante sem números no início. Para na
  // primeira com match bom (>= MIN_SCORE). A pontuação é sempre julgada
  // contra o título original limpo — a variante só muda a busca.
  const variant = titleVariant(title);
  const attempts: Array<{ type: "movie" | "tv"; lang: string; y?: number; q: string }> = [
    { type: primary, lang: "pt-BR", y: year, q: title },
    { type: primary, lang: "pt-BR", q: title },
    { type: primary, lang: "en-US", y: year, q: title },
    { type: secondary, lang: "pt-BR", y: year, q: title },
  ];
  if (variant && variant !== title) {
    attempts.push({ type: primary, lang: "pt-BR", y: year, q: variant });
    attempts.push({ type: primary, lang: "en-US", y: year, q: variant });
  }
  for (const a of attempts) {
    const results = await limited(() => searchOnce(a.type, a.q, a.y, a.lang, key));
    let best: { item: SearchItem; score: number } | null = null;
    for (const item of results.slice(0, 10)) {
      // tudo25: o título original do TMDB também vale — filme estrangeiro
      // pode ter o nome em português diferente do original. Pega o melhor
      // dos dois, sempre contra o título limpo do painel.
      const s = Math.max(
        scoreMatch(title, year, item.title ?? item.name ?? "", item.release_date ?? item.first_air_date),
        scoreMatch(title, year, item.original_title ?? item.original_name ?? "", item.release_date ?? item.first_air_date),
      );
      if (!best || s > best.score) best = { item, score: s };
    }
    if (best && best.score >= MIN_SCORE) {
      /* tudo27: runtime e elenco em PARALELO (eram sequenciais — o elenco
         só começava depois do runtime, e sob carga do semáforo o credits
         batia no timeout de 8s). */
      const [runtime, castRes] = details
        ? await Promise.all([
            fetchRuntime(best.item.id, a.type, key),
            fetchCast(best.item.id, a.type, key),
          ])
        : [undefined, { cast: undefined, failed: false } as const];
      /* tudo26: duração do TMDB muito diferente da do arquivo do painel
         = filme errado com o mesmo nome. Rejeita e tenta a próxima
         tentativa (sem ano, outro idioma...). */
      if (runtimeMismatch(panelDuration, runtime)) {
        continue;
      }
      /* tudo26: elenco — só no detalhe (details=true), junto com o
         runtime, e só depois que o match passou no check de duração.
         Vai no mesmo cache do resto (chave com "|d"). */
      const meta = toMeta(best.item, runtime, castRes.cast);
      /* tudo27: o elenco falhou por rede/timeout (não por falta de elenco)
         — NÃO cacheia este meta: a próxima abertura do detalhe tenta o
         credits de novo, em vez de servir 7 dias de "sem elenco". */
      if (details && castRes.failed) return { meta, skipCache: true };
      return { meta };
    }
  }
  return { meta: null };
}

/* Cache em memória (500 entradas, evicção FIFO simples). */
const memCache = new Map<string, { at: number; meta: TmdbMeta | null }>();
function memSet(key: string, meta: TmdbMeta | null): void {
  if (memCache.size >= MEM_MAX) {
    const first = memCache.keys().next().value;
    if (first) memCache.delete(first);
  }
  memCache.set(key, { at: Date.now(), meta });
}

function diskPath(cacheKey: string): string {
  const hash = createHash("sha256").update(cacheKey).digest("hex");
  return path.join(CACHE_DIR, `${hash}.json`);
}

/** undefined = miss; null = negativo cacheado; meta = hit. */
async function readDisk(cacheKey: string): Promise<TmdbMeta | null | undefined> {
  try {
    const raw = await fs.readFile(diskPath(cacheKey), "utf8");
    const parsed = JSON.parse(raw) as { at: number; meta: TmdbMeta | null };
    if (!parsed || typeof parsed.at !== "number") return undefined;
    if (Date.now() - parsed.at > CACHE_TTL) return undefined;
    return parsed.meta;
  } catch {
    return undefined;
  }
}

async function writeDisk(cacheKey: string, meta: TmdbMeta | null): Promise<void> {
  try {
    await fs.mkdir(CACHE_DIR, { recursive: true });
    await fs.writeFile(diskPath(cacheKey), JSON.stringify({ at: Date.now(), meta }), "utf8");
    // Poda best-effort: acima de 2000 arquivos, apaga os 200 mais velhos.
    const files = await fs.readdir(CACHE_DIR);
    if (files.length > DISK_MAX_FILES) {
      const infos = await Promise.all(
        files.map(async (name) => {
          try {
            const st = await fs.stat(path.join(CACHE_DIR, name));
            return { name, mtime: st.mtimeMs };
          } catch {
            return null;
          }
        }),
      );
      const sorted = infos
        .filter((i): i is { name: string; mtime: number } => Boolean(i))
        .sort((a, b) => a.mtime - b.mtime)
        .slice(0, 200);
      await Promise.all(
        sorted.map((i) => fs.unlink(path.join(CACHE_DIR, i.name)).catch(() => undefined)),
      );
    }
  } catch {
    /* cache em disco é best-effort — a memória cobre */
  }
}

/** Nome do gênero em português -> id TMDB (para as recomendações do
 * detalhe: o catálogo do painel filtra por id de gênero TMDB). */
export function tmdbGenreId(name: string): number | undefined {
  const wanted = name.trim().toLowerCase();
  for (const [id, label] of GENRE_NAME) {
    if (label.toLowerCase() === wanted) return id;
  }
  return undefined;
}

/**
 * Resolve os dados de exibição do TMDB para um título do painel.
 * Sem chave, sem match ou TMDB fora → null (fail open, a tela usa o painel).
 */
export async function resolveTmdbMeta(ref: TmdbRef): Promise<TmdbMeta | null> {
  const key = credential();
  if (!key) return null;
  const cleaned = cleanTitle(ref.title);
  const title = cleaned.title;
  /* tudo25: nome só com dígitos ("242310") é um id do painel, não um
     título — nem adianta buscar no TMDB. */
  if (!title || /^\d+$/.test(title)) return null;
  const year = cleaned.year ?? ref.year;
  /* tudo28 (item 3): versão do cache (v2). Antes do tudo27, uma falha
     transitória do credits era cacheada SEM elenco por 7 dias (disco +
     memória) — o tudo27 impede NOVAS entradas envenenadas (skipCache),
     mas as ANTIGAS continuam no volume .tmdb-cache e seguiam sendo
     servidas (foi o que deixou "Il corpo" sem elenco no teste do
     tudo27, enquanto títulos novos do painel novo — sem entrada no
     cache — mostravam o elenco). Subir a versão invalida tudo de uma
     vez; os títulos voltam a resolver sob demanda (preguiçoso, só o
     que está na tela). Para subir de novo, basta trocar o prefixo. */
  const cacheKey = `v2|${ref.kind}|${title.toLowerCase()}|${year ?? ""}|${ref.details ? "d" : ""}`;

  const mem = memCache.get(cacheKey);
  if (mem && Date.now() - mem.at < CACHE_TTL) return mem.meta;

  const disk = await readDisk(cacheKey);
  if (disk !== undefined) {
    memSet(cacheKey, disk);
    return disk;
  }

  const { meta, skipCache } = await resolveFresh(
    title,
    year,
    ref.kind,
    ref.details ?? false,
    key,
    typeof ref.duration === "number" && ref.duration > 0 ? ref.duration : undefined,
  );
  if (!skipCache) {
    memSet(cacheKey, meta);
    await writeDisk(cacheKey, meta);
  }
  return meta;
}
