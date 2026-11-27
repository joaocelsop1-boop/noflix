import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
