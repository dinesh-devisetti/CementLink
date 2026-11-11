import { NextResponse } from "next/server";
import { orderIdSchema } from "@/lib/validation/orders";
import { enforceActionLimit } from "@/server/auth/action-limit";
import { discardBody } from "@/server/auth/http";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { cancelOrder } from "@/server/services/orders";

export const runtime = "nodejs";

export const POST = withAuth<{ id: string }>(["CUSTOMER"], async ({ actor, req, params }) => {
  const db = getDb();
  await enforceActionLimit(db, "order", actor.id);
  await discardBody(req);
  await cancelOrder(db, actor, orderIdSchema.parse(params.id));
  return NextResponse.json({ success: true });
});
