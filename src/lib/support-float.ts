/**
 * tudo32: quando o botão flutuante de suporte deve sumir (função pura).
 *
 * O botão é fixed no canto inferior direito (bottom-5 right-5) — o MESMO
 * canto do botão de tela cheia do player. Em /play e /watch (onde o
 * player vive) ou com o documento em tela cheia, o flutuante cobre o
 * botão de fullscreen e o usuário não consegue clicar nele. Fora do
 * player, o botão continua em todas as páginas (o suporte de stream
 * quebrado no player é o "Avisar que não funcionou", não o flutuante).
 * Sem dependências — importável em teste Node.
 */
export function isSupportFloatHidden(
  pathname: string | null | undefined,
  isFullscreen: boolean,
): boolean {
  if (isFullscreen) return true;
  if (!pathname) return false;
  /* tudo33 (b): o usePathname() devolve o caminho COM o prefixo "/app"
     (não há basePath configurado — o appUrl() prefixa "/app" na mão e o
     Traefik só tira o prefixo no servidor). O tudo32 casava só "/play" e
     "/watch" nus, então "/app/play/0" NÃO casava e o botão ficava por cima
     do player. Normaliza tirando o "/app" da frente antes de casar. */
  const path =
    pathname === "/app" || pathname.startsWith("/app/")
      ? pathname.slice(4) || "/"
      : pathname;
  /* casamento por segmento: "/play" e "/play/..." são player; "/playlist"
     ou "/playback" NÃO são (não existem, mas o prefixo cru esconderia). */
  const isPlayerRoute = (base: string): boolean =>
    path === base || path.startsWith(`${base}/`);
  return isPlayerRoute("/play") || isPlayerRoute("/watch");
}
