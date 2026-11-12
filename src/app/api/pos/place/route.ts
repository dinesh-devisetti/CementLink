import { NextResponse } from "next/server";
import { placeSchema } from "@/lib/validation/drafts";
import { enforceActionLimit } from "@/server/auth/action-limit";
import { readJson } from "@/server/auth/http";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { placePos } from "@/server/services/po-lifecycle";

export const runtime = "nodejs";

export const POST = withAuth<Record<string, never>>(["DISTRIBUTOR"], async ({ actor, req }) => {
  const db = getDb();
  await enforceActionLimit(db, "draft", actor.id);
  const input = placeSchema.parse(await readJson(req));
  const data = await placePos(db, actor, input);
  return NextResponse.json({ success: true, data });
});
