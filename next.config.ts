import fs from "node:fs";
import path from "node:path";
import type { NextConfig } from "next";

const projectRoot = fs.realpathSync.native(process.cwd());

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  poweredByHeader: false,
  experimental: {
    workerThreads: true,
  },
  // Build mandiri untuk Docker (image kecil). Root dipatok ke folder proyek
  // agar hasil build sama di lokal maupun CI.
  output: "standalone",
  outputFileTracingRoot: projectRoot,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
  turbopack: {
    root: projectRoot,
    rules: {
      "*.css": {
        loaders: [
          {
            loader: "@tailwindcss/turbopack",
            options: {
              base: path.join(projectRoot, "src"),
            },
          },
        ],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
