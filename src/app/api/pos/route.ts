import { NextResponse } from "next/server";
import { z } from "zod";
import { limitSchema, pageSchema } from "@/lib/validation/pagination";
import { orderIdSchema } from "@/lib/validation/orders";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { PO_STATUSES } from "@/server/db/schema";
import { listPos } from "@/server/services/pos";

export const runtime = "nodejs";

const querySchema = z.object({ status: z.enum(PO_STATUSES).optional(), orderId: orderIdSchema.optional(), page: pageSchema, limit: limitSchema });

export const GET = withAuth<Record<string, never>>(["DISTRIBUTOR", "PROVIDER"], async ({ actor, req }) => {
  const sp = new URL(req.url).searchParams;
  const q = querySchema.parse({
    status: sp.get("status") ?? undefined, orderId: sp.get("orderId") ?? undefined, page: sp.get("page") ?? undefined, limit: sp.get("limit") ?? undefined,
  });
  const { rows, total } = await listPos(getDb(), actor, q);
  return NextResponse.json({ success: true, data: rows, meta: { total, page: q.page, limit: q.limit } });
});
