import { phpApi, phpResponse } from "@/lib/php";

export const dynamic = "force-dynamic";

/** POST /api/panel/logout — forwards to PHP action=logout. */
export async function POST(request: Request) {
  const result = await phpApi("logout", {
    method: "POST",
    cookies: request.headers.get("cookie"),
  });
  return phpResponse(result);
}
