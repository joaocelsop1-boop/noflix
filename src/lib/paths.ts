/**
 * Base path do app em produção: o app vive em cineplus.shop/app (o site de
 * vendas fica na raiz cineplus.shop/). Tem que ser igual ao `basePath` do
 * next.config.ts — mude nos dois lugares juntos.
 *
 * O Next.js prefixa o basePath AUTOMATICAMENTE em: Link href, router.push /
 * router.replace, redirect() do servidor e usePathname (que devolve o
 * caminho SEM o basePath). O que NÃO é prefixado e precisa deste helper:
 *   • fetch("/api/...") — o navegador pediria na raiz e cairia no site
 *   • window.location.href = "..." — navegação crua, sem prefixo
 *   • URLs que o servidor devolve ao cliente (/php/stream.php, /api/hls)
 *   • caminhos de assets locais (/img/...) usados como <img src>
 */
export const BASE_PATH = "/app";

/** Prefixa um caminho de API/rota interna com o basePath do app. */
export const apiUrl = (path: string) => `${BASE_PATH}${path}`;

/** Prefixa um caminho de página/asset com o basePath do app. */
export const appUrl = (path: string) => `${BASE_PATH}${path}`;
