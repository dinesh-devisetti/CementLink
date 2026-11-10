import { NextResponse } from "next/server";
import { requestIdSchema } from "@/lib/validation/requests";
import { enforceActionLimit } from "@/server/auth/action-limit";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { rejectLine } from "@/server/services/lines";

export const runtime = "nodejs";

export const POST = withAuth<{ id: string }>(["DISTRIBUTOR"], async ({ actor, params }) => {
  const db = getDb();
  await enforceActionLimit(db, "line:decide", actor.id);
  await rejectLine(db, actor.id, requestIdSchema.parse(params.id));
  return NextResponse.json({ success: true });
});
