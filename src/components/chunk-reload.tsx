"use client";

import { useEffect } from "react";
import { autoReloadOnce } from "@/lib/auto-reload";

/**
 * tudo25: o "Application error" do /app/login na primeira tentativa (3ª
 * vez — tudo23, tudo24 e agora) tem a cara de corrida de chunk pós-deploy:
 * o navegador segura o HTML/JS antigo em cache, o chunk novo não bate e
 * a hidratação estoura; no reload o chunk certo já está lá e funciona.
 * Não achamos causa fixável no código do login (fetchPanelMe tem .catch,
 * nenhum uso de window em render, store só lê localStorage em efeito).
 * Mitigação: ao detectar falha de carregamento de chunk (script/link ou
 * rejeição de import dinâmico), faz reload duro com orçamento
 * (auto-reload.ts — até 5 por sessão, com 2s entre eles, nunca em loop).
 * Se não for chunk, nada acontece e o erro segue para a fronteira
 * global (global-error.tsx).
 *
 * tudo27: este componente só cobre erros DEPOIS da hidratação — os
 * listeners vivem num useEffect, que só roda depois que a página
 * hidratou. Um chunk que falha DURANTE a carga inicial (o caso do login
 * na 1ª tentativa) dispara o erro antes de qualquer listener existir.
 * Por isso o layout agora instala os mesmos listeners num script inline
 * no <head> (antes de qualquer chunk) — este fica como reforço para os
 * chunks carregados depois (navegação, imports dinâmicos).
 */
function isChunkError(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("loading chunk") ||
    m.includes("chunkloaderror") ||
    m.includes("failed to fetch dynamically imported module") ||
    m.includes("importing a module script failed") ||
    m.includes("unable to load") ||
    m.includes("load failed")
  );
}

export function ChunkReload() {
  useEffect(() => {
    /* tudo27: o reload é o do helper partilhado (mesmo contador do
       script inline do layout e das fronteiras de erro — tudo28: até 5
       por sessão, não um só). */
    const reloadOnce = () => {
      autoReloadOnce();
    };

    const onError = (event: ErrorEvent) => {
      const target = event.target as HTMLElement | null;
      const failedResource =
        target && (target.tagName === "SCRIPT" || target.tagName === "LINK");
      if (failedResource || isChunkError(event.message ?? "")) reloadOnce();
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const message =
        typeof reason === "string"
          ? reason
          : reason instanceof Error
            ? reason.message
            : "";
      if (isChunkError(message)) reloadOnce();
    };

    window.addEventListener("error", onError, true);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError, true);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
