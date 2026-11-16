import { NextResponse } from "next/server";
import { createCustomerInvoiceSchema } from "@/lib/validation/customer-invoices";
import { orderIdSchema } from "@/lib/validation/orders";
import { enforceActionLimit } from "@/server/auth/action-limit";
import { readJson } from "@/server/auth/http";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { createCustomerInvoice } from "@/server/services/customer-invoices";

export const runtime = "nodejs";

export const POST = withAuth<{ id: string }>(["DISTRIBUTOR"], async ({ actor, req, params }) => {
  const db = getDb();
  await enforceActionLimit(db, "customer-invoice", actor.id);
  const input = createCustomerInvoiceSchema().parse(await readJson(req));
  const data = await createCustomerInvoice(db, actor, orderIdSchema.parse(params.id), input);
  return NextResponse.json({ success: true, data }, { status: 201 });
});
