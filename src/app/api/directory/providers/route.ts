import { NextResponse } from "next/server";
import { directoryQuerySchema } from "@/lib/validation/links";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { listProviderDirectory } from "@/server/services/directory";

export const runtime = "nodejs";

export const GET = withAuth<Record<string, never>>(["DISTRIBUTOR"], async ({ actor, req }) => {
  const sp = new URL(req.url).searchParams;
  const q = directoryQuerySchema.parse({ q: sp.get("q") ?? undefined, page: sp.get("page") ?? undefined, limit: sp.get("limit") ?? undefined });
  const { rows, total } = await listProviderDirectory(getDb(), actor, q);
  return NextResponse.json({ success: true, data: rows, meta: { total, page: q.page, limit: q.limit } });
});
