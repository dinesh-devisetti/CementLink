import type { Config } from "../config";

export function sessionCookieOptions(cfg: Pick<Config, "COOKIE_SECURE" | "NODE_ENV" | "SESSION_TTL_HOURS">) {
  return {
    httpOnly: true,
    secure: cfg.COOKIE_SECURE ? cfg.COOKIE_SECURE === "true" : cfg.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: cfg.SESSION_TTL_HOURS * 3600,
  };
}
