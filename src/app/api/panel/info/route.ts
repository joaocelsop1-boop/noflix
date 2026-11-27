import { NextResponse } from "next/server";
import { phpApi, phpResponse } from "@/lib/php";

export const dynamic = "force-dynamic";

/**
 * GET /api/panel/info?type=movie|series&id=
 * movie → PHP get_vod_info?vod_id= ; series → PHP get_series_info?series_id=.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get("type");
  const id = searchParams.get("id");
  if ((type !== "movie" && type !== "series") || !id || !/^\d+$/.test(id)) {
    return NextResponse.json({ ok: false, error: "invalid-params" }, { status: 400 });
  }

  const result = await phpApi(type === "movie" ? "get_vod_info" : "get_series_info", {
    cookies: request.headers.get("cookie"),
    searchParams: type === "movie" ? { vod_id: id } : { series_id: id },
  });
  return phpResponse(result);
}
