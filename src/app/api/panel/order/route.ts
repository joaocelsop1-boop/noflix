import { NextResponse } from "next/server";
import { phpApi, phpResponse } from "@/lib/php";

export const dynamic = "force-dynamic";

/** POST /api/panel/order { plan_id, whatsapp? } — forwards to PHP create_order. */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid-body" }, { status: 400 });
  }
  const { plan_id, whatsapp } = (body ?? {}) as { plan_id?: unknown; whatsapp?: unknown };
  if (plan_id === undefined || plan_id === null || String(plan_id).trim() === "") {
    return NextResponse.json({ ok: false, error: "missing-plan" }, { status: 400 });
  }
  const result = await phpApi("create_order", {
    method: "POST",
    body: {
      plan_id,
      ...(typeof whatsapp === "string" && whatsapp.trim() ? { whatsapp: whatsapp.trim() } : {}),
    },
    cookies: request.headers.get("cookie"),
  });
  return phpResponse(result);
}
