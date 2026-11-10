import { NextResponse } from "next/server";
import { lineQuerySchema } from "@/lib/validation/lines";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { demandSummary, listLines } from "@/server/services/lines";

export const runtime = "nodejs";

export const GET = withAuth<Record<string, never>>(["DISTRIBUTOR"], async ({ actor, req }) => {
  const sp = new URL(req.url).searchParams;
  const q = lineQuerySchema.parse({
    status: sp.get("status") ?? undefined,
    page: sp.get("page") ?? undefined,
    limit: sp.get("limit") ?? undefined,
  });
  const db = getDb();
  const { rows, total } = await listLines(db, actor.id, q);
  const summary = await demandSummary(db, actor.id);
  return NextResponse.json({ success: true, data: rows, summary, meta: { total, page: q.page, limit: q.limit } });
});
