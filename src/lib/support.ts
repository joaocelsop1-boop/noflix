/**
 * URL do botão "Suporte" a partir do contato configurado no admin
 * (aba Servidor Sigma, seção Suporte — os valores chegam no /api/panel/me).
 *
 * WhatsApp tem prioridade; com só o Telegram, abre o Telegram. Sem contato
 * preenchido, devolve null e o botão "Suporte" não é renderizado.
 */

export function supportUrl(
  whatsapp?: string | null,
  telegram?: string | null,
): string | null {
  const wa = (whatsapp ?? "").trim();
  if (wa) {
    return `https://wa.me/${wa}`;
  }
  const tg = (telegram ?? "").trim().replace(/^@/, "");
  if (tg) {
    return `https://t.me/${tg}`;
  }
  return null;
}

export type SupportOption = {
  kind: "whatsapp" | "telegram";
  label: string;
  url: string;
};

/**
 * tudo34: as DUAS opções de suporte para o botão flutuante — o cliente
 * escolhe WhatsApp ou Telegram. Só entram as que estão configuradas no
 * admin (support_whatsapp / support_telegram); sem nenhuma, a lista vem
 * vazia e o botão não é renderizado. A ordem é WhatsApp primeiro.
 */
export function supportOptions(
  whatsapp?: string | null,
  telegram?: string | null,
): SupportOption[] {
  const options: SupportOption[] = [];
  const wa = (whatsapp ?? "").trim();
  if (wa) {
    options.push({ kind: "whatsapp", label: "WhatsApp", url: `https://wa.me/${wa}` });
  }
  const tg = (telegram ?? "").trim().replace(/^@/, "");
  if (tg) {
    options.push({ kind: "telegram", label: "Telegram", url: `https://t.me/${tg}` });
  }
  return options;
}
