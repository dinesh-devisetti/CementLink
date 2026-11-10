import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { checkOrigin } from "@/server/auth/guards";
import { handleError } from "@/server/auth/http";
import { deleteSession, SESSION_COOKIE } from "@/server/auth/session";
import { sessionCookieOptions } from "@/server/auth/cookie";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";

export const runtime = "nodejs";

export async function POST() {
  const bad = await checkOrigin();
  if (bad) return bad;
  try {
    const jar = await cookies();
    await deleteSession(getDb(), jar.get(SESSION_COOKIE)?.value);
    const res = NextResponse.json({ success: true });
    res.cookies.set(SESSION_COOKIE, "", { ...sessionCookieOptions(getConfig()), maxAge: 0 });
    return res;
  } catch (err) {
    return handleError(err);
  }
}
