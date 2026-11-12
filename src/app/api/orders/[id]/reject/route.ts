import { NextResponse } from "next/server";
import { rejectOrderSchema } from "@/lib/validation/drafts";
import { orderIdSchema } from "@/lib/validation/orders";
import { enforceActionLimit } from "@/server/auth/action-limit";
import { readJson } from "@/server/auth/http";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { rejectOrder } from "@/server/services/drafts";

export const runtime = "nodejs";

export const POST = withAuth<{ id: string }>(["DISTRIBUTOR"], async ({ actor, req, params }) => {
  const db = getDb();
  await enforceActionLimit(db, "draft", actor.id);
  const { reason } = rejectOrderSchema.parse(await readJson(req));
  await rejectOrder(db, actor, orderIdSchema.parse(params.id), reason);
  return NextResponse.json({ success: true });
});
