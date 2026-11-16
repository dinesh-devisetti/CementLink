import { NextResponse } from "next/server";
import { verifyPaymentSchema } from "@/lib/validation/customer-invoices";
import { enforceActionLimit } from "@/server/auth/action-limit";
import { readJson } from "@/server/auth/http";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { verifyPayment } from "@/server/services/payments";

export const runtime = "nodejs";

/** Checkout callback: records AUTHORIZED at most. PAID comes only from the webhook. */
export const POST = withAuth<Record<string, never>>(["CUSTOMER"], async ({ actor, req }) => {
  const db = getDb();
  await enforceActionLimit(db, "payment-verify", actor.id);
  const input = verifyPaymentSchema.parse(await readJson(req));
  return NextResponse.json({ success: true, data: await verifyPayment(db, actor, input) });
});
