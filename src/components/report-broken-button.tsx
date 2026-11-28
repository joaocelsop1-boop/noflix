"use client";

import { useState } from "react";

export type ReportBrokenInfo = {
  /** nome do título como aparece no detalhe */
  title: string;
  kind: "movie" | "series";
  year?: number;
  /** id do painel (filmes/séries do painel) — identifica o título no anti-spam */
  panelId?: number;
  season?: number;
  episode?: number;
};

/**
 * Chave do anti-spam no front (1 aviso por título por sessão): a mesma
 * ideia existe no servidor (a sessão PHP guarda a chave), então nem
 * recarregar a página nem abrir outro navegador furam o limite — o
 * servidor é a trava de verdade, isto aqui só deixa o botão certo na hora.
 */
export function reportBrokenKey(info: ReportBrokenInfo): string {
  const id =
    info.panelId && info.panelId > 0
      ? `panel-${info.panelId}`
      : `title-${info.title.trim().toLowerCase()}|${info.year ?? 0}`;
  const ep =
    info.kind === "series" && info.season && info.episode
      ? `:S${info.season}E${info.episode}`
      : "";
  return `nf-reported-broken:${info.kind}:${id}${ep}`;
}

function alreadyReported(info: ReportBrokenInfo): boolean {
  try {
    return window.sessionStorage.getItem(reportBrokenKey(info)) === "1";
  } catch {
    return false;
  }
}

function markReported(info: ReportBrokenInfo): void {
  try {
    window.sessionStorage.setItem(reportBrokenKey(info), "1");
  } catch {
    /* armazenamento indisponível — o servidor continua sendo a trava */
  }
}

/**
 * tudo29: botão "Avisar que não funcionou" — só aparece na tela de erro
 * de reprodução, e só quando o dono configurou o Telegram no admin
 * (`me.report_broken` = true). Depois do clique vira "Aviso enviado ✓"
 * e não deixa enviar de novo para o mesmo título na mesma sessão.
 *
 * tudo34: botão GRANDE e chamativo (largura total, texto grande, vermelho
 * de destaque) com frase clara convidando a avisar o suporte — impossível
 * de passar despercebido na tela de erro. Depois do clique continua
 * virando "✓ Aviso enviado".
 *
 * Se o envio falhar, a página NÃO quebra: mostra "Não foi possível
 * enviar agora" e deixa tentar de novo (nada foi marcado como enviado,
 * nem no front nem no servidor).
 */
export function ReportBrokenButton({
  info,
  enabled,
}: {
  info: ReportBrokenInfo;
  enabled: boolean;
}) {
  const [state, setState] = useState<"idle" | "sending" | "sent" | "failed">(() =>
    alreadyReported(info) ? "sent" : "idle",
  );

  if (!enabled) return null;

  const send = async () => {
    if (state === "sending" || state === "sent") return;
    setState("sending");
    try {
      const res = await fetch("/api/report-broken", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: info.title,
          kind: info.kind,
          year: info.year ?? 0,
          panel_id: info.panelId ?? 0,
          season: info.season ?? 0,
          episode: info.episode ?? 0,
        }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean } | null;
      if (res.ok && data?.ok === true) {
        markReported(info);
        setState("sent");
      } else {
        setState("failed");
      }
    } catch {
      setState("failed");
    }
  };

  if (state === "sent") {
    return (
      <span className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-5 py-3.5 text-[15px] font-bold text-white">
        ✓ Aviso enviado
      </span>
    );
  }

  return (
    <span className="flex w-full flex-col items-center gap-1">
      <button
        type="button"
        onClick={send}
        disabled={state === "sending"}
        className="w-full rounded-xl bg-[#e50914] px-5 py-3.5 text-[15px] font-bold leading-snug text-white shadow-lg transition hover:bg-[#f6121d] active:scale-[0.99] disabled:opacity-60"
      >
        {state === "sending"
          ? "Enviando aviso…"
          : "⚠️ Não conseguiu assistir? Toque aqui e avise o suporte!"}
      </button>
      {state === "failed" && (
        <span className="text-[12px] text-white/60">Não foi possível enviar agora — tente de novo.</span>
      )}
    </span>
  );
}
