import { NextResponse } from "next/server";
import { parseAnalyticsFiltersFromRequest, parseAnalyticsQuery } from "@/lib/validation/admin-analytics";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { getDistributorAnalytics } from "@/server/services/analytics";

export const runtime = "nodejs";

export const GET = withAuth<Record<string, never>>(["ADMIN"], async ({ actor, req }) => {
  const q = parseAnalyticsQuery(req);
  const f = parseAnalyticsFiltersFromRequest(req);
  const { rows, total, totals } = await getDistributorAnalytics(getDb(), actor, q, undefined, f);
  return NextResponse.json({ success: true, data: rows, meta: { total, page: q.page, limit: q.limit, totals } });
});
