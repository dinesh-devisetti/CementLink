import { NextResponse } from "next/server";
import { createPaymentOrderSchema } from "@/lib/validation/customer-invoices";
import { enforceActionLimit } from "@/server/auth/action-limit";
import { readJson } from "@/server/auth/http";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { createPaymentOrder } from "@/server/services/payments";

export const runtime = "nodejs";

export const POST = withAuth<Record<string, never>>(["CUSTOMER"], async ({ actor, req }) => {
  const db = getDb();
  await enforceActionLimit(db, "payment-order", actor.id);
  const input = createPaymentOrderSchema.parse(await readJson(req));
  const data = await createPaymentOrder(db, actor, input.customerInvoiceId);
  return NextResponse.json({ success: true, data });
});
