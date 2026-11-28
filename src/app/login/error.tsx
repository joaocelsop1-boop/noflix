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
 * tudo24: limite de erro do login — a página /app/login quebrou 1x na
 * primeira carga ("Application error — A client-side exception has
 * occurred", só funcionou após reload). A causa mais provável é uma
 * corrida de chunk no primeiro carregamento pós-deploy (transitório,
 * sem causa no código da página). Com o limite, em vez da tela de erro
 * genérica do Next.js, o usuário vê uma tela nossa com "Tentar
 * novamente" — que recarrega só o segmento.
 *
 * tudo27 (item 3): a fronteira agora recarrega UMA vez sozinha ao montar
 * (mesmo flag do script inline do layout — um só por sessão), em vez de
 * mostrar a tela de erro de cara. Erro transitório de chunk some sem o
 * usuário ver nada; erro que persiste aparece a tela com o botão (o
 * reload já foi usado, não entra em loop).
 *
 * tudo28 (item 2): igual ao global-error.tsx — tenta `reset()` ANTES
 * (até 2 por página/sessão) e só cai para o reload duro quando o reset
 * não resolve; o reload agora tem orçamento de 5 por sessão, não 1.
 *
 * tudo31: mesmo loop de recuperação do global-error.tsx — o efeito
 * re-roda a cada NOVO erro (antes rodava uma só vez por montagem e, se
 * o reset falhasse, a tela ficava parada até o clique manual); erro de
 * chunk/fetch vai direto para o reload duro; enquanto recupera, mostra
 * "Carregando…" em vez da tela de erro; a tela de erro só aparece
 * quando a recuperação esgota, com a mensagem e o digest do erro real
 * visíveis para diagnosticar.
 */
export default function LoginError({
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
    if (isNonRetryableError(error)) {
      setPhase("stuck");
      return;
    }
    attemptsRef.current += 1;
    if (attemptsRef.current > 6) {
      setPhase("stuck");
      return;
    }
    const timer = window.setTimeout(() => {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error]);

  useEffect(() => {
    const t = window.setTimeout(() => setPhase("stuck"), 10000);
    return () => window.clearTimeout(t);
  }, []);

  const detail = `${error?.message ?? ""}${error?.digest ? ` [${error.digest}]` : ""}`.trim();

  if (phase === "recovering") {
    return (
      <main className="grid min-h-screen place-items-center bg-[#07080f] px-4">
        <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#0f1220] p-6 text-center shadow-2xl md:p-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#e50914]">
            CinePlus
          </p>
          <div
            className="mx-auto mt-6 h-10 w-10 animate-spin rounded-full border-[3px] border-white/15 border-t-[#e50914]"
            aria-hidden="true"
          />
          <h1 className="mt-5 text-xl font-bold text-white">Carregando…</h1>
          <p className="mt-2 text-sm leading-relaxed text-white/60">
            Recuperando automaticamente — só um instante.
          </p>
          {detail ? (
            <p className="mt-5 break-words text-[11px] text-white/35">{detail.slice(0, 160)}</p>
          ) : null}
        </div>
      </main>
    );
  }

  return (
    <main className="grid min-h-screen place-items-center bg-[#07080f] px-4">
      <div className="w-full max-w-md rounded-xl border border-white/10 bg-[#0f1220] p-6 text-center shadow-2xl md:p-8">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#e50914]">
          CinePlus
        </p>
        <h1 className="mt-3 text-xl font-bold text-white">
          Algo deu errado ao carregar o login
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-white/60">
          Isso costuma ser um carregamento incompleto — tente de novo.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          className="mt-6 rounded-md btn-neon px-6 py-3 text-sm font-bold transition"
        >
          Tentar novamente
        </button>
        {detail ? (
          <p className="mt-5 break-words text-[11px] text-white/35">{detail.slice(0, 200)}</p>
        ) : null}
      </div>
    </main>
  );
}
