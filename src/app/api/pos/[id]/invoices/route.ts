import { NextResponse } from "next/server";
import { createInvoiceSchema } from "@/lib/validation/invoices";
import { requestIdSchema } from "@/lib/validation/requests";
import { enforceActionLimit } from "@/server/auth/action-limit";
import { readJson } from "@/server/auth/http";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { createInvoice } from "@/server/services/invoices";

export const runtime = "nodejs";

export const POST = withAuth<{ id: string }>(["PROVIDER"], async ({ actor, req, params }) => {
  const db = getDb();
  await enforceActionLimit(db, "invoice:create", actor.id);
  const poId = requestIdSchema.parse(params.id);
  const input = createInvoiceSchema().parse(await readJson(req));
  return NextResponse.json({ success: true, data: await createInvoice(db, actor.id, poId, input) }, { status: 201 });
});
