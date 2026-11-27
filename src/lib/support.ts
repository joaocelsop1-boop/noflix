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
