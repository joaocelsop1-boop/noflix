import { NextResponse } from "next/server";
import { phpApi, phpResponse } from "@/lib/php";

export const dynamic = "force-dynamic";

/** GET /api/panel/me — forwards the PHP session check, incl. Set-Cookie. */
export async function GET(request: Request) {
  const result = await phpApi("me", { cookies: request.headers.get("cookie") });
  if (result.status === 502) return phpResponse(result);
  const res = NextResponse.json(result.data, { status: result.status });
  for (const cookie of result.setCookie) res.headers.append("set-cookie", cookie);
  return res;
}
