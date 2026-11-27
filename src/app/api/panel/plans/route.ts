import { phpApi, phpResponse } from "@/lib/php";

export const dynamic = "force-dynamic";

/** GET /api/panel/plans — forwards to PHP action=plans. */
export async function GET(request: Request) {
  const result = await phpApi("plans", { cookies: request.headers.get("cookie") });
  return phpResponse(result);
}
