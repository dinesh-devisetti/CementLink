import { NextResponse } from "next/server";
import { createOrderSchema, orderListQuerySchema } from "@/lib/validation/orders";
import { enforceActionLimit } from "@/server/auth/action-limit";
import { readJson } from "@/server/auth/http";
import { reserveAttempts } from "@/server/auth/rate-limit";
import { withAuth } from "@/server/auth/with-auth";
import { getConfig } from "@/server/config";
import { getDb } from "@/server/db/client";
import { createOrder, listOrders } from "@/server/services/orders";
import { rateLimitError } from "@/server/services/users";

export const runtime = "nodejs";

export const GET = withAuth<Record<string, never>>(["CUSTOMER", "DISTRIBUTOR"], async ({ actor, req }) => {
  const sp = new URL(req.url).searchParams;
  const q = orderListQuerySchema.parse({ status: sp.get("status") ?? undefined, page: sp.get("page") ?? undefined, limit: sp.get("limit") ?? undefined });
  const { rows, total } = await listOrders(getDb(), actor, q);
  return NextResponse.json({ success: true, data: rows, meta: { total, page: q.page, limit: q.limit } });
});

export const POST = withAuth<Record<string, never>>(["CUSTOMER"], async ({ actor, req }) => {
  const db = getDb();
  await enforceActionLimit(db, "order", actor.id);
  const input = createOrderSchema().parse(await readJson(req));
  const r = await reserveAttempts(db, [`order:${actor.id}`], { maxAttempts: getConfig().REQUEST_MAX_PER_HOUR, windowMinutes: 60 });
  if (!r.allowed) throw rateLimitError(r.retryAfterSec);
  const { id, choiceKg } = await createOrder(db, actor, input);
  return NextResponse.json(
    { success: true, data: { id, status: "REQUESTED", qtyKg: input.qtyKg, choiceKg, distributorId: input.distributorId } },
    { status: 201 },
  );
});
