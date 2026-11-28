import { NextResponse } from "next/server";
import { phpApi, phpResponse } from "@/lib/php";

export const dynamic = "force-dynamic";

/**
 * POST /api/report-broken — o cliente avisa que um título não tocou.
 *
 * Só encaminha para o PHP (action=report_broken), que confere o login,
 * o anti-spam da sessão (1 aviso por título por sessão) e envia ao
 * Telegram com o token do admin. O token NUNCA passa por esta rota nem
 * volta em nenhuma resposta — o front só recebe {ok:true} ou um erro
 * genérico.
 */
export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    body = undefined;
  }
  const result = await phpApi("report_broken", {
    method: "POST",
    cookies: request.headers.get("cookie"),
    body,
  });
  if (result.status === 502) return phpResponse(result);
  const res = NextResponse.json(result.data, { status: result.status });
  for (const cookie of result.setCookie) res.headers.append("set-cookie", cookie);
  return res;
}
