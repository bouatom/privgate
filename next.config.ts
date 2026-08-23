import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Do not polyfill `node:` for the browser. Client Components must import
  // types from `@/lib/models`; Node modules are marked `server-only`.
  serverExternalPackages: ["ws"],
  experimental: {
    staleTimes: {
      dynamic: 0,
      static: 180,
    },
    optimizePackageImports: ["jose"],
  },
};

export default nextConfig;
