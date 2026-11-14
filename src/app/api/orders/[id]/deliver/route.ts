import { NextResponse } from "next/server";
import { orderIdSchema } from "@/lib/validation/orders";
import { enforceActionLimit } from "@/server/auth/action-limit";
import { discardBody } from "@/server/auth/http";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { deliverOrder } from "@/server/services/orders";

export const runtime = "nodejs";

export const POST = withAuth<{ id: string }>(["DISTRIBUTOR"], async ({ actor, req, params }) => {
  const db = getDb();
  await enforceActionLimit(db, "order", actor.id);
  await discardBody(req);
  await deliverOrder(db, actor, orderIdSchema.parse(params.id));
  return NextResponse.json({ success: true });
});
