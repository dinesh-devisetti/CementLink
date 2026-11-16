import { NextResponse } from "next/server";
import { providerPaymentQuerySchema } from "@/lib/validation/provider-payments";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { listProviderPayments } from "@/server/services/provider-payments";

export const runtime = "nodejs";

export const GET = withAuth<Record<string, never>>(["PROVIDER", "DISTRIBUTOR"], async ({ actor, req }) => {
  const sp = new URL(req.url).searchParams;
  const q = providerPaymentQuerySchema.parse({ page: sp.get("page") ?? undefined, limit: sp.get("limit") ?? undefined });
  const { rows, total } = await listProviderPayments(getDb(), actor, q);
  return NextResponse.json({ success: true, data: rows, meta: { total, page: q.page, limit: q.limit } });
});
