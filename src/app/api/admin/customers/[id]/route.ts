import { NextResponse } from "next/server";
import { parseAnalyticsQuery } from "@/lib/validation/admin-analytics";
import { userIdSchema } from "@/lib/validation/admin";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { getAdminCustomer } from "@/server/services/analytics";

export const runtime = "nodejs";

export const GET = withAuth<{ id: string }>(["ADMIN"], async ({ actor, req, params }) => {
  const q = parseAnalyticsQuery(req);
  const { orders, total, ...customer } = await getAdminCustomer(getDb(), actor, userIdSchema.parse(params.id), q);
  return NextResponse.json({ success: true, data: { ...customer, orders }, meta: { total, page: q.page, limit: q.limit } });
});
