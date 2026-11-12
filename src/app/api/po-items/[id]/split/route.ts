import { NextResponse } from "next/server";
import { poItemIdSchema, splitItemSchema } from "@/lib/validation/drafts";
import { enforceActionLimit } from "@/server/auth/action-limit";
import { readJson } from "@/server/auth/http";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { splitItem } from "@/server/services/drafts";

export const runtime = "nodejs";

export const POST = withAuth<{ id: string }>(["DISTRIBUTOR"], async ({ actor, req, params }) => {
  const db = getDb();
  await enforceActionLimit(db, "draft", actor.id);
  const input = splitItemSchema.parse(await readJson(req));
  const data = await splitItem(db, actor, poItemIdSchema.parse(params.id), { version: input.version, qtyKg: input.qtyTonnes, providerId: input.providerId });
  return NextResponse.json({ success: true, data }, { status: 201 });
});
