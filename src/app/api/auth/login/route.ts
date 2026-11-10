import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { DASHBOARD_PATH } from "@/lib/roles";
import { loginSchema } from "@/lib/validation/auth";
import { checkOrigin } from "@/server/auth/guards";
import { clientIp, handleError, readJson } from "@/server/auth/http";
import { sessionCookieOptions } from "@/server/auth/cookie";
import { createSession, deleteSession, SESSION_COOKIE } from "@/server/auth/session";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { authenticate, toPublicUser } from "@/server/services/users";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const bad = await checkOrigin();
  if (bad) return bad;
  try {
    const cfg = getConfig();
    const input = loginSchema.parse(await readJson(req));
    const db = getDb();
    const user = await authenticate(db, input, clientIp(req, cfg.TRUST_PROXY === "true"), {
      maxAttempts: cfg.LOGIN_MAX_ATTEMPTS,
      ipMaxAttempts: cfg.LOGIN_IP_MAX_ATTEMPTS,
      windowMinutes: cfg.LOGIN_WINDOW_MINUTES,
    });
    // drop any session the browser already holds so old tokens do not linger
    await deleteSession(db, (await cookies()).get(SESSION_COOKIE)?.value);
    const { token } = await createSession(db, user.id, cfg.SESSION_TTL_HOURS);
    const redirectTo = user.status === "ACTIVE" ? DASHBOARD_PATH[user.role] : "/pending";
    const res = NextResponse.json({ success: true, data: { ...toPublicUser(user), redirectTo } });
    res.cookies.set(SESSION_COOKIE, token, sessionCookieOptions(cfg));
    return res;
  } catch (err) {
    return handleError(err);
  }
}
