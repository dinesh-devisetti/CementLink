import { NextResponse } from "next/server";
import { paymentIdSchema } from "@/lib/validation/customer-invoices";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { paymentStatus } from "@/server/services/payments";

export const runtime = "nodejs";

export const GET = withAuth<{ id: string }>(["CUSTOMER"], async ({ actor, params }) => {
  return NextResponse.json({ success: true, data: await paymentStatus(getDb(), actor, paymentIdSchema.parse(params.id)) });
});
