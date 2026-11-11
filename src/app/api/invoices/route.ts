import { NextResponse } from "next/server";
import { invoiceQuerySchema } from "@/lib/validation/invoices";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { listInvoices } from "@/server/services/invoices";

export const runtime = "nodejs";

export const GET = withAuth<Record<string, never>>(["PROVIDER", "DISTRIBUTOR"], async ({ actor, req }) => {
  const sp = new URL(req.url).searchParams;
  const q = invoiceQuerySchema.parse({ page: sp.get("page") ?? undefined, limit: sp.get("limit") ?? undefined });
  const role = actor.role as "DISTRIBUTOR" | "PROVIDER";
  const { rows, total } = await listInvoices(getDb(), { id: actor.id, role }, q);
  return NextResponse.json({ success: true, data: rows, meta: { total, page: q.page, limit: q.limit } });
});
