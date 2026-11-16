import { NextResponse } from "next/server";
import { paymentIdSchema } from "@/lib/validation/customer-invoices";
import { enforceActionLimit } from "@/server/auth/action-limit";
import { discardBody } from "@/server/auth/http";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { refreshPayment } from "@/server/services/payments";

export const runtime = "nodejs";

export const POST = withAuth<{ id: string }>(["CUSTOMER"], async ({ actor, req, params }) => {
  const db = getDb();
  await enforceActionLimit(db, "payment-refresh", actor.id);
  await discardBody(req);
  return NextResponse.json({ success: true, data: await refreshPayment(db, actor, paymentIdSchema.parse(params.id)) });
});
