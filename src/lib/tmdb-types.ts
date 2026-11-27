/**
 * Tipos compartilhados da camada TMDB de exibição (server + client).
 * Arquivo só de tipos — nenhum import de runtime, seguro dos dois lados.
 */

/** Um título do painel (ou do player) pedindo os dados de exibição do TMDB. */
export type TmdbRef = {
  /** Chave estável do pedido (o cliente usa para casar a resposta). */
  key: string;
  /** Nome cru (o servidor limpa antes de buscar). */
  title: string;
  year?: number;
  kind: "movie" | "series";
  /** true = buscar também a duração (detalhe/player); falso = só busca. */
  details?: boolean;
  /** tudo26: duração real do arquivo no painel, em minutos (get_vod_info).
     O resolve rejeita um match do TMDB cuja duração difira muito desta —
     é outro filme com o mesmo nome. Só o detalhe (servidor) manda. */
  duration?: number;
};

/** Um membro do elenco vindo dos créditos do TMDB. */
export type TmdbCastMember = {
  /** Nome do ator/atriz. */
  name: string;
  /** Nome do personagem (só quando o TMDB tem). */
  character?: string;
  /** URL completa image.tmdb.org (w185) — só quando o TMDB tem foto. */
  photo?: string;
};

/** Dados de exibição vindos do TMDB — nunca dados de catálogo/stream. */
export type TmdbMeta = {
  tmdbId: number;
  title: string;
  /** URLs completas image.tmdb.org (o cliente passa pelo /api/img). */
  poster?: string;
  backdrop?: string;
  overview?: string;
  /** Nota TMDB 0–10 (só quando o TMDB tem). */
  rating?: number;
  /** Nomes de gênero em português (até 4). */
  genres: string[];
  /** Duração em minutos (só quando details=true e o TMDB tem). */
  runtime?: number;
  /** Elenco principal (só quando details=true e o TMDB tem créditos).
      Até 10, em ordem de destaque — foto, ator e personagem. */
  cast?: TmdbCastMember[];
  year?: number;
};
