/**
 * Recuperação automática de erros transitórios — partilhada pelo script
 * inline do layout (que roda antes de qualquer chunk), pelo ChunkReload
 * (pós-hidratação) e pelas fronteiras de erro (login/error.tsx,
 * global-error.tsx).
 *
 * tudo27: UM reload automático por sessão (flag booleana
 * "nf-chunk-reload-done"). Não bastou: depois de um deploy, VÁRIOS
 * chunks diferentes podem falhar na mesma sessão (cada navegação para
 * uma rota nova pede um chunk novo) — o primeiro erro recarregava
 * sozinho, mas o segundo, terceiro e quarto mostravam a tela de erro.
 * tudo28: o flag virou CONTADOR (até 5 reloads por sessão, com pelo
 * menos 2s entre eles) — cada erro transitório se resolve sozinho, e
 * o teto impede loop quando o erro é permanente (chunk que não existe
 * ou bug de render: depois do teto, a tela de erro aparece com os
 * botões). O flag booleano antigo continua sendo marcado (compat).
 *
 * Além do reload, as fronteiras agora tentam `reset()` ANTES (ver
 * autoResetBudget): o teste do tudo27 mostrou que "Tentar novamente"
 * recupera essas falhas de navegação — o reset é barato (sem recarregar
 * a página) e só cai para o reload quando o reset não resolve.
 *
 * tudo30: o orçamento do tudo28 era por PATHNAME — todos os títulos do
 * painel partilham "/play/0", então 2 resets serviam para TODOS os
 * detalhes juntos; depois de 2 falhas em títulos diferentes, o erro
 * passou a aparecer em TODOS os cliques (séries e filmes em geral). O
 * orçamento agora é por URL (pathname + search, ou seja, por título) e
 * o reload tem teto por URL + teto global por sessão. O reset automático
 * também espera 1,2s (AUTO_RESET_DELAY_MS) para a condição transitória
 * se assentar antes de tentar de novo.
 */
export const AUTO_RELOAD_FLAG = "nf-chunk-reload-done";

/** tudo30: espera antes do reset automático — a condição transitória
    (chunk frio / RSC lento) precisa de um instante para se assentar;
    reset imediato rebatia na mesma condição e queimava o orçamento. */
export const AUTO_RESET_DELAY_MS = 1200;

const RELOAD_COUNT_PREFIX = "nf-chunk-reload-count:";
const RELOAD_AT_KEY = "nf-chunk-reload-at";
const RELOAD_TOTAL_KEY = "nf-chunk-reload-total";
/** Teto de reloads automáticos por URL (anti-loop local). */
export const MAX_AUTO_RELOADS = 5;
/** Teto GLOBAL de reloads automáticos por sessão (anti-loop geral). */
const MAX_AUTO_RELOADS_TOTAL = 20;
/** Intervalo mínimo entre dois reloads automáticos. */
const MIN_RELOAD_GAP_MS = 2000;

/** Se esta sessão ainda tem orçamento de reload automático, marca e
    recarrega. Devolve true quando recarregou (a página vai embora);
    false quando o orçamento acabou — aí quem chamou mostra a tela. */
export function autoReloadOnce(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const now = Date.now();
    const at = Number(window.sessionStorage.getItem(RELOAD_AT_KEY) ?? "0") || 0;
    if (now - at < MIN_RELOAD_GAP_MS) return false;
    const urlKey = `${RELOAD_COUNT_PREFIX}${window.location.pathname}${window.location.search}`;
    const n = Number(window.sessionStorage.getItem(urlKey) ?? "0") || 0;
    if (n >= MAX_AUTO_RELOADS) return false;
    const total = Number(window.sessionStorage.getItem(RELOAD_TOTAL_KEY) ?? "0") || 0;
    if (total >= MAX_AUTO_RELOADS_TOTAL) return false;
    window.sessionStorage.setItem(urlKey, String(n + 1));
    window.sessionStorage.setItem(RELOAD_TOTAL_KEY, String(total + 1));
    window.sessionStorage.setItem(RELOAD_AT_KEY, String(now));
    window.sessionStorage.setItem(AUTO_RELOAD_FLAG, "1");
  } catch {
    return false;
  }
  window.location.reload();
  return true;
}

const RESET_COUNT_PREFIX = "nf-auto-reset:";
/** Teto de resets automáticos por URL/sessão (anti-loop). */
const MAX_AUTO_RESETS_PER_PAGE = 2;

/** Orçamento para um `reset()` automático da fronteira de erro: até 2
    resets por URL (pathname + search — um título = um orçamento) por
    sessão. Devolve true quando pode tentar o reset; false quando o
    orçamento da URL acabou — aí quem chamou cai para o reload duro
    (autoReloadOnce). Um reset que resolve desmonta a fronteira; um que
    falha remonta e consome outra tentativa. */
export function autoResetBudget(): boolean {
  try {
    if (typeof window === "undefined") return false;
    const key = `${RESET_COUNT_PREFIX}${window.location.pathname}${window.location.search}`;
    const n = Number(window.sessionStorage.getItem(key) ?? "0") || 0;
    if (n >= MAX_AUTO_RESETS_PER_PAGE) return false;
    window.sessionStorage.setItem(key, String(n + 1));
    return true;
  } catch {
    return false;
  }
}
