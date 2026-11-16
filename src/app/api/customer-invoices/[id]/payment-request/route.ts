import { NextResponse } from "next/server";
import { customerInvoiceIdSchema } from "@/lib/validation/customer-invoices";
import { enforceActionLimit } from "@/server/auth/action-limit";
import { discardBody } from "@/server/auth/http";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { requestPayment } from "@/server/services/customer-invoices";

export const runtime = "nodejs";

export const POST = withAuth<{ id: string }>(["DISTRIBUTOR"], async ({ actor, req, params }) => {
  const db = getDb();
  await enforceActionLimit(db, "payment-request", actor.id);
  await discardBody(req);
  await requestPayment(db, actor, customerInvoiceIdSchema.parse(params.id));
  return NextResponse.json({ success: true, data: { status: "PAYMENT_REQUESTED" } });
});
