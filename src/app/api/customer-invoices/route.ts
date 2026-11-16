import { NextResponse } from "next/server";
import { listQuerySchema } from "@/lib/validation/customer-invoices";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { listCustomerInvoices } from "@/server/services/customer-invoices";

export const runtime = "nodejs";

export const GET = withAuth<Record<string, never>>(["CUSTOMER", "DISTRIBUTOR"], async ({ actor, req }) => {
  const sp = new URL(req.url).searchParams;
  const q = listQuerySchema.parse({ page: sp.get("page") ?? undefined, limit: sp.get("limit") ?? undefined });
  const { rows, total } = await listCustomerInvoices(getDb(), actor, q);
  return NextResponse.json({ success: true, data: rows, meta: { total, page: q.page, limit: q.limit } });
});
