import { NextResponse } from "next/server";
import { combineSchema } from "@/lib/validation/drafts";
import { enforceActionLimit } from "@/server/auth/action-limit";
import { readJson } from "@/server/auth/http";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { combinePos } from "@/server/services/combine";

export const runtime = "nodejs";

export const POST = withAuth<Record<string, never>>(["DISTRIBUTOR"], async ({ actor, req }) => {
  const db = getDb();
  await enforceActionLimit(db, "draft", actor.id);
  const input = combineSchema.parse(await readJson(req));
  const data = await combinePos(db, actor, input);
  return NextResponse.json({ success: true, data });
});
