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

function getVersion(): number {
  return version;
}

function enqueue(ref: TmdbRef): void {
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

async function flush(): Promise<void> {
  const batch = Array.from(pending.values()).slice(0, 25);
  if (batch.length === 0) return;
  for (const item of batch) pending.delete(item.key);
  try {
    const res = await fetch(apiUrl("/api/tmdb-resolve"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        items: batch.map(({ key, title, year, kind, details }) => ({
          key,
          title,
          year,
          kind,
          details,
        })),
      }),
    });
    if (!res.ok) throw new Error("resolve failed");
    const data = (await res.json()) as { results?: Record<string, TmdbMeta | null> };
    const results = data?.results ?? {};
    for (const item of batch) cache.set(item.key, results[item.key] ?? null);
  } catch {
    for (const item of batch) cache.set(item.key, null);
  }
  notify();
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
