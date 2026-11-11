import { NextResponse } from "next/server";
import { linkIdSchema } from "@/lib/validation/links";
import { enforceActionLimit } from "@/server/auth/action-limit";
import { discardBody } from "@/server/auth/http";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { decideLink } from "@/server/services/links";

export const runtime = "nodejs";

export const POST = withAuth<{ id: string }>(["DISTRIBUTOR", "PROVIDER"], async ({ actor, req, params }) => {
  const db = getDb();
  await enforceActionLimit(db, "link", actor.id);
  await discardBody(req);
  const id = linkIdSchema.parse(params.id);
  await decideLink(db, actor, id, "approve");
  return NextResponse.json({ success: true });
});
