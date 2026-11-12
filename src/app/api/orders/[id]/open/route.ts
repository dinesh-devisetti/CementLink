import { NextResponse } from "next/server";
import { orderIdSchema } from "@/lib/validation/orders";
import { enforceActionLimit } from "@/server/auth/action-limit";
import { discardBody } from "@/server/auth/http";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { openOrder } from "@/server/services/drafts";

export const runtime = "nodejs";

/** REQUESTED -> UNDER_REVIEW with auto drafts. Idempotent: opening an opened order is a no-op. POST only, never a GET. */
export const POST = withAuth<{ id: string }>(["DISTRIBUTOR"], async ({ actor, req, params }) => {
  const db = getDb();
  await enforceActionLimit(db, "draft", actor.id);
  await discardBody(req);
  const { opened } = await openOrder(db, actor, orderIdSchema.parse(params.id));
  return NextResponse.json({ success: true, data: { opened } });
});
