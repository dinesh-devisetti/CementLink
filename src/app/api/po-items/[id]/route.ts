import { NextResponse } from "next/server";
import { editItemSchema, poItemIdSchema } from "@/lib/validation/drafts";
import { enforceActionLimit } from "@/server/auth/action-limit";
import { readJson } from "@/server/auth/http";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { editItemQty } from "@/server/services/drafts";

export const runtime = "nodejs";

export const PATCH = withAuth<{ id: string }>(["DISTRIBUTOR"], async ({ actor, req, params }) => {
  const db = getDb();
  await enforceActionLimit(db, "draft", actor.id);
  const input = editItemSchema.parse(await readJson(req));
  const data = await editItemQty(db, actor, poItemIdSchema.parse(params.id), { version: input.version, qtyKg: input.qtyTonnes });
  return NextResponse.json({ success: true, data });
});
