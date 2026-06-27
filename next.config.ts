import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Produce a standalone server bundle — ideal for Railway / container deploys.
  output: "standalone",
  reactStrictMode: true,
  // Tenant identity is resolved per-request, so pages must never be statically cached.
  experimental: {
    // Keep server actions enabled (default in Next 15) and allow large form bodies.
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
};

export default nextConfig;
