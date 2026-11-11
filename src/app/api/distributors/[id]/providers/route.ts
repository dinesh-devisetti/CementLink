import { NextResponse } from "next/server";
import { linkIdSchema } from "@/lib/validation/links";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { listDistributorProviders } from "@/server/services/directory";

export const runtime = "nodejs";

export const GET = withAuth<{ id: string }>(["CUSTOMER"], async ({ actor, params }) => {
  const data = await listDistributorProviders(getDb(), actor, linkIdSchema.parse(params.id));
  return NextResponse.json({ success: true, data });
});
