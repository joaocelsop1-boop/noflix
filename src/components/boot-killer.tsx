"use client";

import { useEffect } from "react";

/**
 * tudo27 (item 5): o splash "CinePlus" não pode ficar por cima do conteúdo
 * já carregado. O script inline do BootIntro só o tira depois de 1,5s
 * (timer fixo) ou na próxima visita da sessão — num carregamento rápido,
 * o conteúdo já estava pronto e o splash ainda cobria tudo. Este
 * componente roda na hidratação (o app já está interativo) e tira o
 * splash na hora. O timer do script continua como teto para carga lenta.
 */
export function BootKiller() {
  useEffect(() => {
    const el = document.getElementById("nf-boot");
    if (el?.parentNode) el.parentNode.removeChild(el);
    document.documentElement.classList.add("nf-ready");
  }, []);
  return null;
}
