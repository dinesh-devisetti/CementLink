import { NextResponse } from "next/server";
import { createPoSchema, poQuerySchema } from "@/lib/validation/pos";
import { enforceActionLimit } from "@/server/auth/action-limit";
import { readJson } from "@/server/auth/http";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { createPo, listPos } from "@/server/services/pos";

export const runtime = "nodejs";

export const POST = withAuth<Record<string, never>>(["DISTRIBUTOR"], async ({ actor, req }) => {
  const db = getDb();
  await enforceActionLimit(db, "po:create", actor.id);
  const input = createPoSchema.parse(await readJson(req));
  return NextResponse.json({ success: true, data: await createPo(db, actor.id, input) }, { status: 201 });
});

export const GET = withAuth<Record<string, never>>(["DISTRIBUTOR", "PROVIDER"], async ({ actor, req }) => {
  const sp = new URL(req.url).searchParams;
  const q = poQuerySchema.parse({ page: sp.get("page") ?? undefined, limit: sp.get("limit") ?? undefined });
  const role = actor.role as "DISTRIBUTOR" | "PROVIDER";
  const { rows, total } = await listPos(getDb(), { id: actor.id, role }, q);
  return NextResponse.json({ success: true, data: rows, meta: { total, page: q.page, limit: q.limit } });
});
