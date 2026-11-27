/**
 * Limpeza de títulos vindos do painel Xtream — puro (server + client).
 *
 * O painel devolve o nome cru, com metadados embutidos:
 *   "A Dois Passos do Assassino [Lançamento] (2024)"
 *   "Baby Looney Tunes (2002) (2002)"
 *   "Os Desajustados de Seul [L] (2024) (2024)"
 *   "18 Rosas [Lançamento] (2026)"
 *
 * A exibição (e a busca no TMDB) usa o nome limpo + o ano separado.
 * Só tira o que está no FIM do título: "[...]" e "(AAAA)" repetidos.
 * Um ano no meio do nome ("2001: Uma Odisseia no Espaço") fica intacto.
 */

export type CleanedTitle = {
  /** Nome sem "[...]" e sem "(AAAA)" do fim. */
  title: string;
  /** Ano tirado do fim do título (quando havia). */
  year?: number;
};

export function cleanTitle(raw: string): CleanedTitle {
  let s = (raw ?? "").trim();
  // "[Lançamento]", "[L]", "[D]"... — qualquer colchete, em qualquer posição.
  s = s.replace(/\[[^\]]*\]/g, " ");
  // "(AAAA)" do fim, repetido — guarda o primeiro ano válido encontrado.
  let year: number | undefined;
  for (;;) {
    const m = s.match(/\(\s*(\d{4})\s*\)\s*$/);
    if (!m) break;
    const y = Number(m[1]);
    if (year === undefined && y >= 1900 && y <= 2100) year = y;
    s = s.slice(0, m.index ?? 0).trim();
  }
  // Sobra de pontuação depois das remoções ("Título -", "Título :").
  s = s.replace(/[\s\-–—:]+$/, "").trim();
  s = s.replace(/\s{2,}/g, " ").trim();
  return { title: s, year };
}
