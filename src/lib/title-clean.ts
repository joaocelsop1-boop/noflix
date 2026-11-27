/**
 * Limpeza de títulos vindos do painel Xtream — puro (server + client).
 *
 * O painel devolve o nome cru, com metadados embutidos:
 *   "A Dois Passos do Assassino [Lançamento] (2024)"
 *   "Baby Looney Tunes (2002) (2002)"
 *   "Os Desajustados de Seul [L] (2024) (2024)"
 *   "18 Rosas [Lançamento] (2026)"
 *   "1 12 Rodadas" / "2 242310" (índice de lista na frente)
 *   "Ladies First 2026 · 2025" (ano duplicado no fim)
 *   "S Spontaneous.2020" (letra solta + ano com ponto)
 *
 * A exibição (e a busca no TMDB) usa o nome limpo + o ano separado.
 * Só tira o que está no FIM do título: "[...]", "(AAAA)", ".AAAA" e ano
 * solto repetidos — e um índice/letra solta na FRENTE, quando o resto
 * mostra que não faz parte do título. Um ano no meio do nome
 * ("2001: Uma Odisseia no Espaço") fica intacto, e artigo inicial
 * ("A Cacada", "Os Desajustados") nunca é removido.
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
  /* tudo27: ano no fim SEM parênteses, repetido ou com ponto.
     "Ladies First 2026 · 2025" vira "Ladies First" + 2025 (o último ano
     é o do campo ano do painel; o primeiro é o que já estava no nome).
     "Spontaneous.2020" vira "Spontaneous" + 2020. Regra segura: ano com
     ponto ou com "·" sempre sai (é sufixo de arquivo/lista, não do
     título); ano solto com espaço SÓ sai se outro ano já foi tirado
     (ano duplicado) — sozinho, "Blade Runner 2049" fica intacto, porque
     2049 faz parte do título. */
  /* só o loop de ano solto/ponto liga este flag — o "(AAAA)" do parêntese
     não conta, senão "A Dois Passos do Assassino (2024)" perderia o "A". */
  let strippedTrailingYear = false;
  for (;;) {
    // ".2020" ou "· 2025" — sufixo, sempre tira.
    let m = s.match(/(?:\.|·)\s*(\d{4})\s*$/);
    if (m) {
      const y = Number(m[1]);
      if (y >= 1900 && y <= 2100) {
        if (year === undefined) year = y;
        strippedTrailingYear = true;
        s = s.slice(0, m.index ?? 0).trim();
        continue;
      }
    }
    // " 2026" solto — só no caso duplicado (já tirou outro ano antes).
    if (strippedTrailingYear) {
      m = s.match(/\s+(\d{4})\s*$/);
      if (m) {
        const y = Number(m[1]);
        if (y >= 1900 && y <= 2100) {
          if (year === undefined) year = y;
          s = s.slice(0, m.index ?? 0).trim();
          continue;
        }
      }
    }
    break;
  }
  /* tudo27: índice de lista na frente do título ("1 12 Rodadas",
     "2 242310") — um número curto seguido de outro número é o índice da
     lista, não o título. Só tira quando o próximo token também começa
     com dígito: "12 Rodadas" e "3 Ninjas" ficam intactos. */
  for (let i = 0; i < 2; i++) {
    const m = s.match(/^(\d{1,2})\s+(?=\d)/);
    if (!m) break;
    s = s.slice(m[0].length).trim();
  }
  /* tudo27: letra solta na frente ("S Spontaneous.2020") — só tira
     quando um ano foi tirado do fim: a letra é um prefixo estranho do
     painel, não o título. Sem ano no fim, o artigo fica ("A Cacada"). */
  if (strippedTrailingYear) {
    const m = s.match(/^[A-Za-z]\s+(?=\S)/);
    if (m) s = s.slice(m[0].length).trim();
  }
  // Sobra de pontuação depois das remoções ("Título -", "Título :").
  s = s.replace(/[\s\-–—:.]+$/, "").trim();
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
