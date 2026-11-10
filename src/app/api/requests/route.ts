import { NextResponse } from "next/server";
import { z } from "zod";
import { createRequestSchema } from "@/lib/validation/requests";
import { readJson } from "@/server/auth/http";
import { reserveAttempts } from "@/server/auth/rate-limit";
import { getConfig } from "@/server/config";
import { rateLimitError } from "@/server/services/users";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { createRequest, listRequests } from "@/server/services/requests";

export const runtime = "nodejs";

const querySchema = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export const POST = withAuth<Record<string, never>>(["CUSTOMER"], async ({ actor, req }) => {
  const db = getDb();
  const limit = await reserveAttempts(db, [`req:create:${actor.id}`], {
    maxAttempts: getConfig().REQUEST_MAX_PER_HOUR,
    windowMinutes: 60,
  });
  if (!limit.allowed) throw rateLimitError(limit.retryAfterSec);
  const input = createRequestSchema().parse(await readJson(req));
  const data = await createRequest(db, actor.id, input);
  return NextResponse.json({ success: true, data }, { status: 201 });
});

export const GET = withAuth<Record<string, never>>(["CUSTOMER"], async ({ actor, req }) => {
  const sp = new URL(req.url).searchParams;
  const q = querySchema.parse({ page: sp.get("page") ?? undefined, limit: sp.get("limit") ?? undefined });
  const { rows, total } = await listRequests(getDb(), actor.id, q);
  return NextResponse.json({ success: true, data: rows, meta: { total, page: q.page, limit: q.limit } });
});
