import { NextResponse } from "next/server";
import { resolveStreams } from "@/lib/stream-resolver";
import { proxied } from "@/lib/stream-sign";
import { phpMe } from "@/lib/php";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * A resolved stream stays good for hours, so remember it for a few minutes:
 * hopping between episodes and coming back should feel instant, and the
 * providers get one hit instead of one per reload.
 */
const CACHE_TTL = 10 * 60 * 1000;
const CACHE_MAX = 200;
const cache = new Map<string, { at: number; body: unknown }>();

const noStore = { "cache-control": "no-store" };

/**
 * GET /api/stream?tmdb=155&kind=movie&season=1&episode=1
 *
 * Resolves the actual HLS/MP4 a title lives on, so NOFLIX can play it in its
 * own player. Sources come back twice: the CDN URL (played straight from the
 * viewer's IP, with no Referer) and a signed /api/hls fallback for hosts that
 * insist on one.
 *
 * `ok: false` is a normal answer — the player then falls back to the embeds.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);

  /* Panel titles (tmdbId 0): /api/stream?panel=1&type=live|movie|series&id=&ext=
     Streams go through the same-origin /php/stream.php rewrite, so the
     browser never sees the panel credentials. Requires an active plan. */
  if (searchParams.get("panel") === "1") {
    return panelStream(request, searchParams);
  }

  const tmdbId = Number(searchParams.get("tmdb"));
  const kind = searchParams.get("kind") === "series" ? "series" : "movie";
  const season = Math.max(Number(searchParams.get("season") ?? 1) || 1, 1);
  const episode = Math.max(Number(searchParams.get("episode") ?? 1) || 1, 1);

  if (!Number.isFinite(tmdbId) || tmdbId <= 0) {
    return NextResponse.json({ ok: false, reason: "bad-id", sources: [] }, { status: 400 });
  }

  const key = `${kind}:${tmdbId}:${season}:${episode}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) {
    return NextResponse.json(hit.body, { headers: noStore });
  }

  try {
    const result = await resolveStreams({ tmdbId, kind, season, episode });

    if (!result.sources.length) {
      return NextResponse.json({ ok: false, reason: "no-sources", sources: [] }, { headers: noStore });
    }

    const body = {
      ok: true as const,
      provider: result.provider,
      expiresIn: result.expiresIn,
      count: result.sources.length,
      sources: result.sources.map((source) => ({
        provider: source.provider,
        label: source.label,
        quality: source.quality,
        type: source.type,
        codec: source.codec,
        /* the CDN itself: browsers reach it from the viewer's own IP, which
           these hosts are far kinder to than a datacenter */
        url: source.url,
        /* and the signed same-origin relay, for hosts that refuse a bare
           request from the page origin */
        proxy: proxied(source.url, source.referer),
      })),
    };

    if (cache.size >= CACHE_MAX) {
      const oldest = cache.keys().next().value;
      if (oldest) cache.delete(oldest);
    }
    cache.set(key, { at: Date.now(), body });

    return NextResponse.json(body, { headers: noStore });
  } catch {
    return NextResponse.json({ ok: false, reason: "resolver-error", sources: [] }, { headers: noStore });
  }
}

/**
 * Panel stream: verifies the PHP session (active plan required) and returns
 * the same-origin /php/stream.php proxy URL as both url and proxy.
 */
async function panelStream(request: Request, searchParams: URLSearchParams) {
  const type = searchParams.get("type");
  const id = Number(searchParams.get("id"));
  const ext = searchParams.get("ext") ?? "";
  const season = searchParams.get("season");
  const episode = searchParams.get("episode");

  if ((type !== "live" && type !== "movie" && type !== "series") || !Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ ok: false, reason: "bad-id", sources: [] }, { status: 400, headers: noStore });
  }

  const me = await phpMe(request.headers.get("cookie"));
  if (me === null) {
    return NextResponse.json({ ok: false, reason: "panel-unavailable", sources: [] }, { status: 503, headers: noStore });
  }
  if (!me.canWatch) {
    return NextResponse.json({ ok: false, reason: "plan-required", sources: [] }, { status: 403, headers: noStore });
  }

  const params = new URLSearchParams({ type, id: String(id) });
  if (ext) params.set("ext", ext);
  if (type === "series") {
    if (season) params.set("season", season);
    if (episode) params.set("episode", episode);
  }
  const url = `/php/stream.php?${params.toString()}`;

  return NextResponse.json(
    {
      ok: true as const,
      provider: "panel",
      sources: [
        {
          provider: "panel",
          label: "Painel",
          quality: "FHD",
          type: type === "live" ? "m3u8" : "mp4",
          url,
          proxy: url,
        },
      ],
    },
    { headers: noStore },
  );
}
