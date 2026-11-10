import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // e2e builds use their own folder so they never clobber the running dev server's .next
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["@node-rs/argon2", "@libsql/client"],
};

export default nextConfig;
