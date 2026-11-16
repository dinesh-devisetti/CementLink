import { NextResponse } from "next/server";
import { poIdSchema } from "@/lib/validation/drafts";
import { createProviderInvoiceSchema } from "@/lib/validation/provider-invoices";
import { enforceActionLimit } from "@/server/auth/action-limit";
import { readJson } from "@/server/auth/http";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { createProviderInvoice } from "@/server/services/provider-invoices";

export const runtime = "nodejs";

export const POST = withAuth<{ id: string }>(["PROVIDER"], async ({ actor, req, params }) => {
  const db = getDb();
  await enforceActionLimit(db, "invoice", actor.id);
  const input = createProviderInvoiceSchema().parse(await readJson(req));
  const data = await createProviderInvoice(db, actor, poIdSchema.parse(params.id), input);
  return NextResponse.json({ success: true, data }, { status: 201 });
});
