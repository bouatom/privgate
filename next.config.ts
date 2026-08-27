import os from "node:os";
import type { NextConfig } from "next";

/** Next.js 15 blocks LAN Host headers in `next dev` unless listed here. */
function lanDevOrigins(): string[] {
  const hosts = new Set<string>(["localhost", "127.0.0.1"]);
  for (const addrs of Object.values(os.networkInterfaces())) {
    for (const addr of addrs || []) {
      const family = String(addr.family);
      if ((family === "IPv4" || family === "4") && !addr.internal) hosts.add(addr.address);
    }
  }
  for (const raw of (process.env.PRIVGATE_TRUSTED_HOSTS || "").split(",")) {
    const host = raw.trim().split(":")[0];
    if (host) hosts.add(host);
  }
  try {
    const pub = process.env.PRIVGATE_PUBLIC_ORIGIN;
    if (pub) hosts.add(new URL(pub).hostname);
  } catch {
    /* ignore malformed origin */
  }
  return [...hosts];
}

const nextConfig: NextConfig = {
  allowedDevOrigins: lanDevOrigins(),
  output: "standalone",
  // Do not polyfill `node:` for the browser. Client Components must import
  // types from `@/lib/models`; Node modules are marked `server-only`.
  serverExternalPackages: ["ws", "ldapts"],
  experimental: {
    staleTimes: {
      dynamic: 0,
      static: 180,
    },
    optimizePackageImports: ["jose"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              "connect-src 'self' ws: wss:",
              "object-src 'none'",
              "base-uri 'self'",
              "frame-ancestors 'self'",
              "form-action 'self'",
            ].join("; "),
          },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
