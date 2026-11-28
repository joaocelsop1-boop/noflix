"use client";

import { useEffect, useSyncExternalStore } from "react";
import { apiUrl } from "./paths";
import { cleanTitle } from "./title-clean";
import type { TmdbMeta, TmdbRef } from "./tmdb-types";

export type { TmdbMeta, TmdbRef };

/**
 * Cliente da camada TMDB de exibição — tudo24.
 *
 * Cada cartão/herói/detalhe pede os dados do seu título com useTmdbMeta;
 * os pedidos se acumulam numa fila e saem num único POST para
 * /api/tmdb-resolve (até 25 por vez), com debounce de 120 ms. O resultado
 * fica num cache em memória do módulo (a tela inteira compartilha) e todos
 * os assinantes re-renderizam quando ele chega. Sem match, o cache guarda
 * null para não pedir o mesmo título de novo. Falha de rede também vira
 * null — a tela usa os dados do painel (fail open).
 *
 * Retorno do hook: undefined = ainda resolvendo (usa o painel por enquanto),
 * null = resolvido sem match, meta = resolvido com dados do TMDB.
 */

/** Chave estável do pedido (título limpo + ano + tipo). */
export function tmdbRefKey(ref: TmdbRef): string {
  const c = cleanTitle(ref.title);
  return `${ref.kind}:${c.title.toLowerCase()}:${c.year ?? ref.year ?? ""}${ref.details ? ":d" : ""}`;
}

const cache = new Map<string, TmdbMeta | null>();
const pending = new Map<string, TmdbRef>();
let version = 0;
const listeners = new Set<() => void>();
let flushTimer: number | null = null;

function notify(): void {
  version += 1;
  listeners.forEach((l) => l());
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** Estado da fila — só leitura, exportado para teste (tudo32). */
export function tmdbQueueSnapshot(): { pending: number; cached: number } {
  return { pending: pending.size, cached: cache.size };
}

/** Limpa fila/cache — só para teste (tudo32). Nunca chamar em produção. */
export function tmdbQueueReset(): void {
  pending.clear();
  cache.clear();
  version = 0;
}

function getVersion(): number {
  return version;
}

export function enqueue(ref: TmdbRef): void {
  const key = tmdbRefKey(ref);
  if (cache.has(key) || pending.has(key)) return;
  pending.set(key, { ...ref, key });
  if (flushTimer === null) {
    flushTimer = window.setTimeout(() => {
      flushTimer = null;
      void flush();
    }, 120);
  }
}

/** true enquanto um drain está em voo — evita dois drains concorrentes. */
let flushing = false;

/** Tentativas de rede por chave (tudo33): uma falha TRANSITÓRIA (rede,
 *  5xx, timeout do proxy) NÃO pode virar null permanente — antes, o catch
 *  marcava o lote inteiro como null e os 25 cards ficavam sem ★/ano até
 *  recarregar a página, mesmo com o servidor bom. Até 3 tentativas por
 *  chave; depois disso, desiste (null) para não martelar o servidor. */
const retryCount = new Map<string, number>();
const MAX_RETRIES = 3;

export async function flush(): Promise<void> {
  if (flushing) return;
  flushing = true;
  try {
    /* tudo32: drena a fila INTEIRA em lotes de 25. Antes, o flush pegava
       só os 25 primeiros e o resto ficava pendente PARA SEMPRE — só um
       NOVO enqueue disparava outro flush. Com 96 cards por página (e
       ~200 enqueues na home), só os ~25 primeiros resolviam: os cards do
       fim da grade e as séries (que enfileiram por último) nunca
       mostravam ★/ano. O loop re-checa `pending` a cada lote, então
       enqueues que chegam durante o drain entram no mesmo drain. */
    while (pending.size > 0) {
      const batch = Array.from(pending.values()).slice(0, 25);
      for (const item of batch) pending.delete(item.key);
      let batchFailed = false;
      try {
        const res = await fetch(apiUrl("/api/tmdb-resolve"), {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            items: batch.map(({ key, title, year, kind, details, duration }) => ({
              key,
              title,
              year,
              kind,
              details,
              duration,
            })),
          }),
        });
        if (!res.ok) throw new Error("resolve failed");
        const data = (await res.json()) as { results?: Record<string, TmdbMeta | null> };
        const results = data?.results ?? {};
        for (const item of batch) {
          cache.set(item.key, results[item.key] ?? null);
          retryCount.delete(item.key);
        }
      } catch {
        /* tudo33: falha de REDE (não "sem match" — o servidor devolve
           null por chave quando não há match, e isso SIM é cacheado).
           Re-enfileira para tentar de novo em vez de envenenar o cache:
           o lote volta para o fim da fila e o drain o retenta depois de
           uma pausa maior (2s), até MAX_RETRIES vezes. */
        batchFailed = true;
        for (const item of batch) {
          const n = (retryCount.get(item.key) ?? 0) + 1;
          retryCount.set(item.key, n);
          if (n <= MAX_RETRIES) {
            pending.set(item.key, item);
          } else {
            retryCount.delete(item.key);
            cache.set(item.key, null);
          }
        }
      }
      notify();
      /* pausa curta entre lotes: a UI pinta os primeiros resultados
         antes do próximo lote resolver, e o servidor não é martelado.
         Depois de um lote com falha, a pausa é maior (2s) para o
         servidor/rede se recuperar antes da retentativa. */
      if (pending.size > 0) {
        await new Promise((resolve) =>
          window.setTimeout(resolve, batchFailed ? 2000 : 60),
        );
      }
    }
  } finally {
    flushing = false;
  }
}

/** Resolve um título (null = não pedir; undefined = resolvendo). */
export function useTmdbMeta(ref: TmdbRef | null): TmdbMeta | null | undefined {
  useSyncExternalStore(subscribe, getVersion);
  const key = ref ? tmdbRefKey(ref) : "";
  useEffect(() => {
    if (ref) enqueue(ref);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  if (!ref) return undefined;
  return cache.get(key);
}

/**
 * Resolve vários títulos de uma vez (herói, fileira). Devolve só os já
 * resolvidos COM dados — use `.has(key)` para saber se já resolveu
 * (mesmo sem match). A chave do mapa é o `key` do TmdbRef de entrada.
 */
export function useTmdbMetas(refs: TmdbRef[]): Map<string, TmdbMeta | null> {
  useSyncExternalStore(subscribe, getVersion);
  const keys = refs.map(tmdbRefKey).join("|");
  useEffect(() => {
    for (const ref of refs) enqueue(ref);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys]);
  const out = new Map<string, TmdbMeta | null>();
  for (const ref of refs) {
    const k = tmdbRefKey(ref);
    if (cache.has(k)) out.set(ref.key, cache.get(k) ?? null);
  }
  return out;
}
