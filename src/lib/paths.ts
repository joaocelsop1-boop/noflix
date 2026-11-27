/**
 * Prefixo do app em produção: o app vive em cineplus.shop/app (o site de
 * vendas fica na raiz cineplus.shop/).
 *
 * NÃO há mais `basePath` no next.config.ts: o Traefik (Coolify, Path /app)
 * tira o /app antes de repassar ao Next.js, então o Next.js recebe os
 * caminhos sem o prefixo e o basePath daria 404 em tudo. Por isso TODA
 * URL que o navegador pede tem que levar o /app na mão, via estes helpers:
 *   • Link href, router.push / router.replace — usar appUrl("/...")
 *   • fetch("/api/...") — o navegador pediria na raiz e cairia no site
 *   • window.location.href = "..." — navegação crua, sem prefixo
 *   • URLs que o servidor devolve ao cliente (/php/stream.php, /api/hls)
 *   • caminhos de assets locais (/img/...) usados como <img src>
 * Os assets estáticos usam assetPrefix "/app" no next.config.ts.
 */
export const BASE_PATH = "/app";

/** Prefixa um caminho de API/rota interna com o basePath do app. */
export const apiUrl = (path: string) => `${BASE_PATH}${path}`;

/** Prefixa um caminho de página/asset com o basePath do app. */
export const appUrl = (path: string) => `${BASE_PATH}${path}`;
