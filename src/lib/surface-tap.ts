/**
 * Decisão pura da superfície de toque do player (tudo37b).
 *
 * O problema: o 1º toque no vídeo parado só AGENDava o play para 250ms
 * depois (para esperar um possível duplo-toque). O usuário, sem ver nada
 * acontecer, tocava de novo dentro de 320ms — o 2º toque era classificado
 * como duplo-toque, CANCELAVA o play agendado e buscava ±10s (invisível
 * num vídeo parado no 0:00). E se o 2º toque caísse depois de 320ms, ele
 * agendava um PAUSE que disparava logo depois do play começar. Resultado:
 * precisava de ~3 toques para o vídeo começar.
 *
 * A regra nova:
 * - vídeo parado → "play-now": toca NA HORA, sem esperar nada;
 * - duplo-toque → busca ±10s (vale até durante o buffering: pular para
 *   frente num vídeo travado é um gesto legítimo);
 * - tocando mas travado (buffering), toque único → "ignore": o vídeo já
 *   está tentando tocar; um toque impaciente não pode agendar um pause;
 * - tocando normal, toque único → mantém o discriminador antigo (pausa
 *   após 250ms, para não brigar com o duplo-toque).
 *
 * Sem dependências (nem React): testável em Node compilando este arquivo
 * com o tsc do projeto.
 */
export type SurfaceTapAction =
  | "play-now"
  | "ignore"
  | "seek-back"
  | "seek-forward"
  | "schedule-toggle";

export function decideSurfaceTap(args: {
  /** o elemento de vídeo está pausado (cobre também `ended`) */
  paused: boolean;
  /** o elemento disparou 'waiting' e ainda não voltou a tocar */
  waiting: boolean;
  /** instante (ms) do toque anterior registrado */
  lastAt: number;
  /** posição x do toque anterior registrado */
  lastX: number;
  /** posição x deste toque */
  x: number;
  /** largura da superfície de toque */
  width: number;
  /** instante (ms) deste toque */
  now: number;
}): SurfaceTapAction {
  if (args.paused) return "play-now";
  const doubled =
    args.now - args.lastAt < 320 && Math.abs(args.x - args.lastX) < 140;
  if (doubled) return args.x < args.width * 0.38 ? "seek-back" : "seek-forward";
  if (args.waiting) return "ignore";
  return "schedule-toggle";
}
