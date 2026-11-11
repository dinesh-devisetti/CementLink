import { NextResponse } from "next/server";
import { linkListQuerySchema, requestLinkSchema } from "@/lib/validation/links";
import { enforceActionLimit } from "@/server/auth/action-limit";
import { readJson } from "@/server/auth/http";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { listLinks, requestLink } from "@/server/services/links";

export const runtime = "nodejs";

export const GET = withAuth<Record<string, never>>(["CUSTOMER", "DISTRIBUTOR", "PROVIDER"], async ({ actor, req }) => {
  const sp = new URL(req.url).searchParams;
  const q = linkListQuerySchema.parse({ kind: sp.get("kind") ?? undefined, page: sp.get("page") ?? undefined, limit: sp.get("limit") ?? undefined });
  const { rows, total } = await listLinks(getDb(), actor, q);
  return NextResponse.json({ success: true, data: rows, meta: { total, page: q.page, limit: q.limit } });
});

export const POST = withAuth<Record<string, never>>(["CUSTOMER", "DISTRIBUTOR"], async ({ actor, req }) => {
  const db = getDb();
  await enforceActionLimit(db, "link", actor.id);
  const { targetId } = requestLinkSchema.parse(await readJson(req));
  await requestLink(db, actor, targetId);
  return NextResponse.json({ success: true }, { status: 201 });
});
