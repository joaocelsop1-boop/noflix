"use client";

import Link from "next/link";

/**
 * CTA de plano (frameXTV): mostrado no lugar do player quando o usuário
 * não tem plano ativo (canWatch=false) ou o stream responde 403
 * plan-required. Não é um erro — é o caminho para assinar.
 */
export function PlanGate({ reason }: { reason?: string }) {
  return (
    <div className="absolute inset-0 z-40 grid place-items-center bg-black px-6 text-center">
      <div className="max-w-md">
        <p className="text-[11px] font-semibold uppercase tracking-[0.24em] text-[#e50914]">
          You&apos;re watching · CinePlus
        </p>
        <h2 className="mt-3 text-2xl font-bold text-white md:text-3xl">
          Ative um plano para assistir
        </h2>
        <p className="mt-2 text-sm leading-relaxed text-white/60">
          {reason ??
            "Este conteúdo faz parte do seu painel e precisa de um plano ativo. Escolha um plano, pague com Pix e libere na hora."}
        </p>
        <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
          <Link
            href="/planos"
            className="rounded-md bg-[#e50914] px-6 py-3 text-sm font-bold text-white transition hover:bg-[#f6121d]"
          >
            Ver planos
          </Link>
          <Link
            href="/login"
            className="rounded-md border border-white/25 px-6 py-3 text-sm font-semibold text-white/85 transition hover:border-white/60 hover:text-white"
          >
            Entrar
          </Link>
        </div>
      </div>
    </div>
  );
}
