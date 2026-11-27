import "server-only";

import { phpApi } from "@/lib/php";

/**
 * get_series_info em cache (10 min, por série).
 *
 * A página do player busca a lista de episódios (via /api/panel/info) E a
 * resolução do stream buscava a MESMA info de novo (via /api/stream) — 2
 * viagens ao painel por série tocada, cada uma passando pelo proxy do
 * cPanel. Aqui as duas usam a mesma busca: quem chega primeiro busca, o
 * resto espera por ela dentro dos 10 min.
 */
const SERIES_INFO_TTL = 10 * 60 * 1000;
const seriesInfoCache = new Map<string, { at: number; data: unknown }>();

export async function cachedSeriesInfo(
  seriesId: number,
  cookies: string | null,
): Promise<unknown> {
  const key = `series:${seriesId}`;
  const hit = seriesInfoCache.get(key);
  if (hit && Date.now() - hit.at < SERIES_INFO_TTL) return hit.data;
  const info = await phpApi("get_series_info", {
    searchParams: { series_id: String(seriesId) },
    cookies,
  });
  if (info.status === 200 && info.data) {
    if (seriesInfoCache.size >= 200) seriesInfoCache.clear();
    seriesInfoCache.set(key, { at: Date.now(), data: info.data });
    return info.data;
  }
  return info.data ?? null;
}
