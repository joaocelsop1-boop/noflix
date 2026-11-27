import { NextResponse } from "next/server";
import { phpApi, phpResponse } from "@/lib/php";

export const dynamic = "force-dynamic";

const KIND_TO_ACTION: Record<string, string> = {
  movie: "get_vod_streams",
  series: "get_series",
  live: "get_live_streams",
};

/**
 * GET /api/panel/catalog?kind=movie|series|live&category_id=&limit=&offset=
 * Forwards to the matching PHP list action and returns the raw JSON plus a
 * `total` count. kind defaults to movie.
 */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const kind = searchParams.get("kind") ?? "movie";
  const action = KIND_TO_ACTION[kind];
  if (!action) {
    return NextResponse.json({ ok: false, error: "invalid-kind" }, { status: 400 });
  }

  const result = await phpApi(action, {
    cookies: request.headers.get("cookie"),
    timeoutMs: 60_000,
    searchParams: {
      category_id: searchParams.get("category_id") ?? undefined,
      limit: searchParams.get("limit") ?? undefined,
      offset: searchParams.get("offset") ?? undefined,
    },
  });
  if (result.status === 502) return phpResponse(result);

  const data = result.data;
  let body: unknown;
  if (Array.isArray(data)) {
    body = { ok: true, items: data, total: data.length };
  } else if (typeof data === "object" && data !== null) {
    const record = data as Record<string, unknown>;
    const items = Array.isArray(record.items) ? record.items : undefined;
    const total =
      typeof record.total === "number"
        ? record.total
        : items
          ? items.length
          : undefined;
    body = { ...record, ...(total !== undefined ? { total } : {}) };
  } else {
    body = { ok: true, items: [], total: 0 };
  }

  const res = NextResponse.json(body, { status: result.status });
  for (const cookie of result.setCookie) res.headers.append("set-cookie", cookie);
  return res;
}
