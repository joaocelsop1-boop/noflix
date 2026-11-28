"use client";

import { useEffect, useRef, useState } from "react";
import {
  AUTO_RESET_DELAY_MS,
  autoReloadOnce,
  autoResetBudget,
  isChunkOrFetchError,
  isNonRetryableError,
  recordLastError,
} from "@/lib/auto-reload";

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
 *
 * tudo31 — CAUSA REAL do erro na 1ª tentativa (teste do tudo30, 22:15–
 * 22:21): o erro aparecia na PRIMEIRA tentativa de quase toda navegação
 * (MOANA 2, Bad Boys, A Avaliação, O Peso da Liberdade, A Noiva,
 * Novidades, Séries, voltar, login) e o retry SEMPRE funcionava — mas a
 * tela ficava parada até o clique manual. A causa é o mecanismo de
 * auto-recuperação, não os dados: o useEffect rodava UMA vez por
 * montagem; se o reset() falhasse, nada mais acontecia (a fronteira não
 * desmonta quando o reset falha — ela só recebe outro erro — e o efeito
 * não re-rodava). Além disso, reset() é a recuperação ERRADA para erro
 * de chunk/RSC: ele retenta o mesmo chunk/RSC que acabou de falhar. E
 * os listeners de chunk (script inline + ChunkReload) NÃO veem esses
 * erros — o roteador do Next.js captura a rejeição internamente e joga
 * para a fronteira. Por isso a fronteira é o ÚNICO ponto de recuperação
 * e agora é um LOOP de verdade:
 *   - o efeito re-roda a cada NOVO erro (dep [error]);
 *   - erro de chunk/fetch vai DIRETO para o reload duro;
 *   - erro de render tenta reset() (orçamento por URL) e escala para o
 *     reload duro quando o orçamento acaba;
 *   - enquanto recupera, mostra um estado "Carregando…" (spinner), não
 *     a tela de erro — erro transitório vira um carregamento breve;
 *   - a tela de erro só aparece quando a recuperação esgota (fase
 *     "stuck"), com a mensagem e o digest do erro real visíveis para o
 *     teste ao vivo diagnosticar;
 *   - o erro é gravado no sessionStorage (nf-last-error) e no console.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const [phase, setPhase] = useState<"recovering" | "stuck">("recovering");
  const attemptsRef = useRef(0);

  useEffect(() => {
    recordLastError(error);
    // Erro que não adianta retentar (rota inexistente): mostra a tela direto.
    if (isNonRetryableError(error)) {
      setPhase("stuck");
      return;
    }
    attemptsRef.current += 1;
    // Trava de segurança contra loop infinito (os orçamentos já limitam,
    // mas se o erro mudar de identidade a cada render, isto segura).
    if (attemptsRef.current > 6) {
      setPhase("stuck");
      return;
    }
    const timer = window.setTimeout(() => {
      // Erro de chunk/RSC/fetch: reset() retenta o mesmo chunk/RSC que
      // falhou — vai direto para o reload duro (documento novo, chunks novos).
      if (isChunkOrFetchError(error)) {
        if (!autoReloadOnce()) setPhase("stuck");
        return;
      }
      if (autoResetBudget()) {
        reset();
        return;
      }
      if (!autoReloadOnce()) setPhase("stuck");
    }, AUTO_RESET_DELAY_MS);
    return () => window.clearTimeout(timer);
    // Re-roda quando um NOVO erro chega (o reset falhou e a fronteira
    // recebeu outro erro): é o loop de recuperação. Antes o efeito tinha
    // deps [] e rodava uma só vez — se o reset falhasse, a tela ficava
    // parada até o clique manual.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  // Segurança: se a recuperação não resolveu em 10s, mostra a tela com os
  // botões em vez de deixar o usuário no spinner para sempre.
  useEffect(() => {
    const t = window.setTimeout(() => setPhase("stuck"), 10000);
    return () => window.clearTimeout(t);
  }, []);

  const detail = `${error?.message ?? ""}${error?.digest ? ` [${error.digest}]` : ""}`.trim();

  if (phase === "recovering") {
    return (
      <html lang="pt-BR" style={{ backgroundColor: "#0d1526", colorScheme: "dark" }}>
        <body className="min-h-screen bg-[#0d1526] text-white antialiased">
          <main className="grid min-h-screen place-items-center px-6 text-center">
            <div className="max-w-md">
              <p className="text-[11px] font-bold uppercase tracking-[0.24em] text-[#e50914]">
                CinePlus
              </p>
              <div
                className="mx-auto mt-6 h-10 w-10 animate-spin rounded-full border-[3px] border-white/15 border-t-[#e50914]"
                aria-hidden="true"
              />
              <h1 className="mt-5 text-xl font-bold">Carregando…</h1>
              <p className="mt-2 text-sm leading-relaxed text-white/60">
                Recuperando automaticamente — só um instante.
              </p>
              {detail ? (
                <p className="mt-5 break-words text-[11px] text-white/35">{detail.slice(0, 160)}</p>
              ) : null}
            </div>
          </main>
        </body>
      </html>
    );
  }

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
            {detail ? (
              <p className="mt-5 break-words text-[11px] text-white/35">{detail.slice(0, 200)}</p>
            ) : null}
          </div>
        </main>
      </body>
    </html>
  );
}
