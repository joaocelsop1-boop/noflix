import { NextResponse } from "next/server";
import { phpApi, phpResponse } from "@/lib/php";

export const dynamic = "force-dynamic";

/** POST /api/panel/register { name, email, password, whatsapp? } — forwards to PHP action=register. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid-body" }, { status: 400 });
  }
  const { name, email, password, whatsapp } = (body ?? {}) as {
    name?: unknown;
    email?: unknown;
    password?: unknown;
    whatsapp?: unknown;
  };
  if (
    typeof name !== "string" ||
    !name.trim() ||
    typeof email !== "string" ||
    !email.trim() ||
    typeof password !== "string" ||
    !password
  ) {
    return NextResponse.json({ ok: false, error: "missing-fields" }, { status: 400 });
  }
  const result = await phpApi("register", {
    method: "POST",
    body: {
      name: name.trim(),
      email: email.trim(),
      password,
      ...(typeof whatsapp === "string" && whatsapp.trim() ? { whatsapp: whatsapp.trim() } : {}),
    },
    cookies: request.headers.get("cookie"),
  });
  return phpResponse(result);
}
