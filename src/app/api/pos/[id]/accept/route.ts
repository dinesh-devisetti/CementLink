import { NextResponse } from "next/server";
import { poIdSchema } from "@/lib/validation/drafts";
import { enforceActionLimit } from "@/server/auth/action-limit";
import { discardBody } from "@/server/auth/http";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { acceptPo } from "@/server/services/po-provider";

export const runtime = "nodejs";

export const POST = withAuth<{ id: string }>(["PROVIDER"], async ({ actor, req, params }) => {
  const db = getDb();
  await enforceActionLimit(db, "po", actor.id);
  await discardBody(req);
  await acceptPo(db, actor, poIdSchema.parse(params.id));
  return NextResponse.json({ success: true });
});
