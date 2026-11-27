/**
 * tudo27 (item 3): UM reload automático por sessão, partilhado por todos
 * os mecanismos de recuperação — o script inline do layout (que roda antes
 * de qualquer chunk), o ChunkReload (pós-hidratação) e as fronteiras de
 * erro (login/error.tsx, global-error.tsx). Sem um flag único, cada
 * mecanismo recarregaria sozinho e o usuário veria a página piscar várias
 * vezes — ou entrar em loop. Com ele: no máximo um reload automático por
 * sessão; depois disso, quem chamou mostra a tela de erro com o botão.
 */
export const AUTO_RELOAD_FLAG = "nf-chunk-reload-done";

/** Se esta sessão ainda não fez o reload automático, marca e recarrega.
    Devolve true quando recarregou (a página vai embora); false quando o
    reload já foi usado — aí quem chamou mostra a tela de erro. */
export function autoReloadOnce(): boolean {
  try {
    if (typeof window === "undefined") return false;
    if (window.sessionStorage.getItem(AUTO_RELOAD_FLAG)) return false;
    window.sessionStorage.setItem(AUTO_RELOAD_FLAG, "1");
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}
