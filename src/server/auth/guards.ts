import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { getConfig } from "../config";
import { getDb } from "../db/client";
import type { Role, User } from "../db/schema";
import { originAllowed } from "./origin";
import { decideApi, decidePage } from "./decide";
import { resolveSession, SESSION_COOKIE } from "./session";

export async function getActor(): Promise<User | null> {
  const jar = await cookies();
  return resolveSession(getDb(), jar.get(SESSION_COOKIE)?.value);
}

export function errorResponse(httpStatus: number, code: string, error: string) {
  return NextResponse.json({ success: false, error, code }, { status: httpStatus });
}

/** For route handlers. Returns the actor, or a ready-made error response. */
export async function requireRole(...roles: Role[]): Promise<{ actor: User } | { response: NextResponse }> {
  const actor = await getActor();
  const d = decideApi(actor, roles);
  if (!d.ok || !actor) {
    if (d.ok) return { response: errorResponse(401, "UNAUTHENTICATED", "Not signed in") };
    const msg = d.code === "PENDING" ? "Account not approved" : d.code === "FORBIDDEN" ? "Not allowed" : "Not signed in";
    return { response: errorResponse(d.httpStatus, d.code, msg) };
  }
  return { actor };
}

/** For server components/pages. Redirects when not allowed. */
export async function requireRolePage(...roles: Role[]): Promise<User> {
  const actor = await getActor();
  const d = decidePage(actor, roles);
  if (!d.ok || !actor) redirect(d.ok ? "/login" : d.redirectTo);
  return actor;
}

export async function checkOrigin(): Promise<NextResponse | null> {
  const h = await headers();
  if (originAllowed(h.get("origin"), getConfig().APP_URL)) return null;
  return errorResponse(403, "BAD_ORIGIN", "Bad origin");
}
