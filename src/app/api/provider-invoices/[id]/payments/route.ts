import { NextResponse } from "next/server";
import { poIdSchema } from "@/lib/validation/drafts";
import { createProviderPaymentSchema } from "@/lib/validation/provider-payments";
import { enforceActionLimit } from "@/server/auth/action-limit";
import { readJson } from "@/server/auth/http";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { createProviderPayment } from "@/server/services/provider-payments";

export const runtime = "nodejs";

export const POST = withAuth<{ id: string }>(["DISTRIBUTOR"], async ({ actor, req, params }) => {
  const db = getDb();
  await enforceActionLimit(db, "provider-payment", actor.id);
  const input = createProviderPaymentSchema().parse(await readJson(req));
  const data = await createProviderPayment(db, actor, poIdSchema.parse(params.id), input);
  return NextResponse.json({ success: true, data }, { status: 201 });
});
