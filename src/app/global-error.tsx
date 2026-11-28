"use client";

import { useEffect } from "react";
import { AUTO_RESET_DELAY_MS, autoReloadOnce, autoResetBudget } from "@/lib/auto-reload";

/**
 * tudo25: erro global (raiz) — o "Application error" do /app/login
 * aparecia na primeira tentativa e só sumia com reload manual. O
 * login/error.tsx (tudo24) cobre só o segmento /login; um erro que
 * estoura na raiz (chunk novo pós-deploy, hidratação) não tinha
 * fronteira nenhuma. Esta cobre a raiz e dá ao usuário um botão de
 * recarregar, em vez de uma página morta.
 *
 * tudo27 (item 3): igual ao login/error.tsx — recarrega UMA vez sozinha
 * ao montar (mesmo flag do script inline do layout — um só por sessão).
 * Erro transitório some sem o usuário ver a tela; erro que persiste
 * mostra a tela com os botões.
 *
 * tudo28 (item 2): a tela continuou aparecendo na NAVEGAÇÃO (4 vezes no
 * teste do tudo27) porque o flag do tudo27 era UM reload por sessão —
 * o primeiro erro se resolvia sozinho, os seguintes mostravam a tela.
 * Agora a fronteira tenta `reset()` ANTES (o teste mostrou que "Tentar
 * novamente" recupera essas falhas — o reset é barato e não recarrega
 * a página; até 2 por página/sessão) e só cai para o reload duro quando
 * o reset não resolve — e o reload agora tem orçamento de 5 por sessão,
 * não 1. Erro permanente (depois dos tetos) mostra a tela com os botões.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // tudo30: espera 1,2s antes do reset automático — a condição
    // transitória (chunk frio / RSC lento) precisa se assentar; o reset
    // imediato do tudo28 rebatia na mesma condição e queimava o
    // orçamento. reset() primeiro (recupera a falha de navegação sem
    // recarregar a página); reload duro só quando o reset não resolve.
    const timer = window.setTimeout(() => {
      if (autoResetBudget()) {
        reset();
        return;
      }
      autoReloadOnce();
    }, AUTO_RESET_DELAY_MS);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <html lang="pt-BR" style={{ backgroundColor: "#0d1526", colorScheme: "dark" }}>
      <body className="min-h-screen bg-[#0d1526] text-white antialiased">
        <main className="grid min-h-screen place-items-center px-6 text-center">
          <div className="max-w-md">
            <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#e50914]">
              CinePlus
            </p>
            <h1 className="mt-3 text-2xl font-bold">Algo deu errado ao carregar</h1>
            <p className="mt-2 text-sm leading-relaxed text-white/60">
              Pode ter sido uma atualização do app — recarregar resolve na
              maioria dos casos.
            </p>
            <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
              <button
                type="button"
                onClick={() => reset()}
                className="rounded-full bg-[#e50914] px-6 py-3 text-sm font-bold text-white transition hover:bg-[#f6121f]"
              >
                Tentar novamente
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-full border border-white/20 px-6 py-3 text-sm font-semibold text-white/85 transition hover:border-white/40 hover:text-white"
              >
                Recarregar a página
              </button>
            </div>
            {error?.digest ? (
              <p className="mt-5 text-[11px] text-white/35">código: {error.digest}</p>
            ) : null}
          </div>
        </main>
      </body>
    </html>
  );
}
