import { NextResponse } from "next/server";
import { orderIdSchema } from "@/lib/validation/orders";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { getOrder } from "@/server/services/orders";

export const runtime = "nodejs";

export const GET = withAuth<{ id: string }>(["CUSTOMER", "DISTRIBUTOR"], async ({ actor, params }) => {
  const data = await getOrder(getDb(), actor, orderIdSchema.parse(params.id));
  return NextResponse.json({ success: true, data });
});
