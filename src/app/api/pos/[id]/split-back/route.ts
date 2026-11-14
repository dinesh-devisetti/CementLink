import { NextResponse } from "next/server";
import { poIdSchema, splitBackSchema } from "@/lib/validation/drafts";
import { enforceActionLimit } from "@/server/auth/action-limit";
import { readJson } from "@/server/auth/http";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { splitBack } from "@/server/services/combine";

export const runtime = "nodejs";

export const POST = withAuth<{ id: string }>(["DISTRIBUTOR"], async ({ actor, req, params }) => {
  const db = getDb();
  await enforceActionLimit(db, "draft", actor.id);
  const input = splitBackSchema.parse(await readJson(req));
  const data = await splitBack(db, actor, poIdSchema.parse(params.id), input);
  return NextResponse.json({ success: true, data }, { status: 201 });
});
