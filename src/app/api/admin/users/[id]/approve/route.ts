import { NextResponse } from "next/server";
import { userIdSchema } from "@/lib/validation/admin";
import { enforceActionLimit } from "@/server/auth/action-limit";
import { discardBody } from "@/server/auth/http";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { decideUser } from "@/server/services/admin-users";

export const runtime = "nodejs";

export const POST = withAuth<{ id: string }>(["ADMIN"], async ({ actor, req, params }) => {
  await enforceActionLimit(getDb(), "admin-user", actor.id);
  await discardBody(req);
  return NextResponse.json({ success: true, data: await decideUser(getDb(), userIdSchema.parse(params.id), "approve") });
});
