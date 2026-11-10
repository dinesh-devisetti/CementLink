import { NextResponse } from "next/server";
import { registerSchema } from "@/lib/validation/auth";
import { checkOrigin } from "@/server/auth/guards";
import { clientIp, handleError, readJson } from "@/server/auth/http";
import { reserveAttempts } from "@/server/auth/rate-limit";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { rateLimitError, registerUser, toPublicUser } from "@/server/services/users";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const bad = await checkOrigin();
  if (bad) return bad;
  try {
    const cfg = getConfig();
    const db = getDb();
    const input = registerSchema.parse(await readJson(req));
    // Limit before any hashing/DB work so duplicate and new registrations cost the same.
    const ip = clientIp(req, cfg.TRUST_PROXY === "true");
    if (ip) {
      const r = await reserveAttempts(db, [`reg-ip:${ip}`], { maxAttempts: cfg.REGISTER_MAX_PER_HOUR, windowMinutes: 60 });
      if (!r.allowed) throw rateLimitError(r.retryAfterSec);
    }
    const user = await registerUser(db, input);
    return NextResponse.json({ success: true, data: toPublicUser(user) }, { status: 201 });
  } catch (err) {
    return handleError(err);
  }
}
