import { NextResponse } from "next/server";
import { phpApi, phpResponse } from "@/lib/php";
import { cachedSeriesInfo } from "@/lib/panel-series-info";

export const dynamic = "force-dynamic";

/**
 * GET /api/panel/info?type=movie|series&id=
 * movie → PHP get_vod_info?vod_id= ; series → PHP get_series_info?series_id=.
 * Série usa o cache compartilhado com /api/stream (10 min): a página do
 * player e a resolução do stream buscavam a mesma info 2x no painel.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const id = searchParams.get("id");
  if ((type !== "movie" && type !== "series") || !id || !/^\d+$/.test(id)) {
    return NextResponse.json({ ok: false, error: "invalid-params" }, { status: 400 });
  }

  if (type === "series") {
    const data = await cachedSeriesInfo(Number(id), request.headers.get("cookie"));
    if (data === null || data === undefined) {
      return NextResponse.json({ ok: false, error: "panel-unavailable" }, { status: 502 });
    }
    return NextResponse.json(data);
  }

  const result = await phpApi("get_vod_info", {
    cookies: request.headers.get("cookie"),
    searchParams: { vod_id: id },
  });
  return phpResponse(result);
}
