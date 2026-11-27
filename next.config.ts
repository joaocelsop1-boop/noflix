import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // O app vive em cineplus.shop/app (o site de vendas fica na raiz).
  // O Traefik (Coolify, Path /app) tira o prefixo /app antes de repassar
  // ao Next.js — por isso NÃO há basePath aqui: com basePath o Next.js
  // esperaria o /app e daria 404 em tudo (o prefixo já foi tirado).
  // O prefixo /app continua nas URLs que o navegador pede, de dois jeitos:
  //   • assetPrefix "/app" — assets estáticos (/app/_next/...) chegam ao
  //     app (o Traefik tira o /app e o Next.js serve /_next/...);
  //   • src/lib/paths.ts (appUrl/apiUrl) — links, router.push, fetch e
  //     window.location prefixam /app na mão, pois sem basePath o Next.js
  //     não prefixa nada sozinho.
  assetPrefix: "/app",
  // Allow the sandbox preview host(s) to talk to the dev server without
  // Next.js rejecting the request as a cross-origin dev request.
  allowedDevOrigins: ["*.e2b.app", "*.arena.ai", "localhost:3000", "127.0.0.1:3000"],
  images: {
    // Local, pre-optimised WebP artwork — no need for the runtime optimiser.
    unoptimized: true,
  },
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_BUILD_ID: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "dev",
    NEXT_PUBLIC_BUILD_TIME: new Date().toISOString(),
    NEXT_PUBLIC_VERCEL_ENV: process.env.VERCEL_ENV ?? "",
  },
  poweredByHeader: false,
  async rewrites() {
    // Same-origin proxy to the internal PHP panel backend: the browser only
    // ever sees /php/*, so the PHP session cookie works without CORS and the
    // internal backend URL / credentials never reach the client.
    return [
      {
        source: "/php/:path*",
        destination: `${process.env.PHP_BACKEND_URL ?? "http://php:80"}/:path*`,
      },
    ];
  },
  experimental: {
    optimizePackageImports: ["framer-motion"],
  },
};

export default nextConfig;
