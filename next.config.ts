import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  distDir: process.env.NEXT_DIST_DIR || '.next',
  allowedDevOrigins: ['127.0.0.1', '192.168.0.115'],
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    serverActions: {
      bodySizeLimit: '20mb',
      allowedOrigins: ['127.0.0.1:3000', 'localhost:3000', '192.168.0.115:3000', '192.168.0.115'],
    },
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
