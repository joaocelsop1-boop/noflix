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

/** Tags de áudio/qualidade no fim do nome — não fazem parte do título. */
const AUDIO_TAGS = /^(leg|legendado|dub|dublado|dual|original|nacional|4k|hd|sd|fullhd|bluray|web-dl|hdtv|remaster|estendido|extended|dc)$/i;

export function cleanTitle(raw: string): CleanedTitle {
  let s = (raw ?? "").trim();
  // "[Lançamento]", "[L]", "[D]"... — qualquer colchete, em qualquer posição.
  s = s.replace(/\[[^\]]*\]/g, " ");
  // "(AAAA)" e "(TAG)" do fim, repetidos — guarda o primeiro ano válido.
  // "THE K2 (LEG)" vira "THE K2"; "Baby Looney Tunes (2002) (2002)"
  // vira "Baby Looney Tunes" + 2002.
  let year: number | undefined;
  for (;;) {
    const m = s.match(/\(\s*([^()]*)\s*\)\s*$/);
    if (!m) break;
    const inner = m[1].trim();
    if (/^\d{4}$/.test(inner)) {
      const y = Number(inner);
      if (year === undefined && y >= 1900 && y <= 2100) year = y;
      s = s.slice(0, m.index ?? 0).trim();
      continue;
    }
    if (AUDIO_TAGS.test(inner)) {
      s = s.slice(0, m.index ?? 0).trim();
      continue;
    }
    break;
  }
  // Sobra de pontuação depois das remoções ("Título -", "Título :").
  s = s.replace(/[\s\-–—:]+$/, "").trim();
  s = s.replace(/\s{2,}/g, " ").trim();
  return { title: s, year };
}

/**
 * Chave de deduplicação: título limpo normalizado + ano. Dois itens do
 * painel com o mesmo nome limpo e o mesmo ano são o mesmo título
 * ("The K2" e "THE K2 (LEG)" viram um só).
 */
export function titleKey(name: string, year?: number): string {
  const c = cleanTitle(name);
  const norm = c.title
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
  return `${norm}|${c.year ?? year ?? ""}`;
}
