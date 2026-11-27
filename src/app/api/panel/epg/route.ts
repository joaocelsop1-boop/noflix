import { NextResponse } from "next/server";
import { phpApi, phpResponse } from "@/lib/php";

export const dynamic = "force-dynamic";

/** GET /api/panel/epg?stream_id= — forwards to PHP action=get_epg. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const streamId = searchParams.get("stream_id");
  if (!streamId || !/^\d+$/.test(streamId)) {
    return NextResponse.json({ ok: false, error: "invalid-params" }, { status: 400 });
  }
  const result = await phpApi("get_epg", {
    cookies: request.headers.get("cookie"),
    searchParams: { stream_id: streamId },
  });
  return phpResponse(result);
}
