import { NextResponse } from "next/server";
import { phpApi, phpResponse } from "@/lib/php";

export const dynamic = "force-dynamic";

/** GET /api/panel/order-status?order_id= — forwards to PHP action=order_status. */
export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const orderId = searchParams.get("order_id");
  if (!orderId) {
    return NextResponse.json({ ok: false, error: "invalid-params" }, { status: 400 });
  }
  const result = await phpApi("order_status", {
    cookies: request.headers.get("cookie"),
    searchParams: { order_id: orderId },
  });
  return phpResponse(result);
}
