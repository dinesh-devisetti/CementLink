import { NextResponse } from "next/server";
import { providerInvoiceQuerySchema } from "@/lib/validation/provider-invoices";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { listProviderInvoices } from "@/server/services/provider-invoices";

export const runtime = "nodejs";

export const GET = withAuth<Record<string, never>>(["PROVIDER", "DISTRIBUTOR"], async ({ actor, req }) => {
  const sp = new URL(req.url).searchParams;
  const q = providerInvoiceQuerySchema.parse({ page: sp.get("page") ?? undefined, limit: sp.get("limit") ?? undefined });
  const { rows, total } = await listProviderInvoices(getDb(), actor, q);
  return NextResponse.json({ success: true, data: rows, meta: { total, page: q.page, limit: q.limit } });
});
