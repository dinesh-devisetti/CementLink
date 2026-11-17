import type { NextConfig } from "next";
import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  // e2e builds use their own folder so they never clobber the running dev server's .next
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["@node-rs/argon2", "@libsql/client"],
  async headers() {
    const isDev = process.env.NODE_ENV === "development";
    // HSTS only for real production (E2E_HTTP=1 marks the localhost e2e server, which runs NODE_ENV=production over http)
    const isProd = process.env.NODE_ENV === "production" && process.env.E2E_HTTP !== "1";
    return [
      { source: "/:path*", headers: securityHeaders(isDev, isProd) },
      // Covers API routes outside withAuth too (/api/me, login, logout, webhook)
      { source: "/api/:path*", headers: [{ key: "Cache-Control", value: "no-store" }] },
    ];
  },
};

export default nextConfig;
