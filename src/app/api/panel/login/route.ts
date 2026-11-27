import { NextResponse } from "next/server";
import { phpApi, phpResponse } from "@/lib/php";

export const dynamic = "force-dynamic";

/** POST /api/panel/login { email, password } — forwards to PHP action=login. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid-body" }, { status: 400 });
  }
  const { email, password } = (body ?? {}) as { email?: unknown; password?: unknown };
  if (typeof email !== "string" || !email.trim() || typeof password !== "string" || !password) {
    return NextResponse.json({ ok: false, error: "missing-credentials" }, { status: 400 });
  }
  const result = await phpApi("login", {
    method: "POST",
    body: { email: email.trim(), password },
    cookies: request.headers.get("cookie"),
  });
  return phpResponse(result);
}
