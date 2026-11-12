import { NextResponse } from "next/server";
import { editPoSchema, poIdSchema } from "@/lib/validation/drafts";
import { enforceActionLimit } from "@/server/auth/action-limit";
import { readJson } from "@/server/auth/http";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { editPo } from "@/server/services/drafts";
import { getPo } from "@/server/services/pos";

export const runtime = "nodejs";

export const GET = withAuth<{ id: string }>(["DISTRIBUTOR", "PROVIDER", "CUSTOMER"], async ({ actor, params }) => {
  const data = await getPo(getDb(), actor, poIdSchema.parse(params.id));
  return NextResponse.json({ success: true, data });
});

export const PATCH = withAuth<{ id: string }>(["DISTRIBUTOR"], async ({ actor, req, params }) => {
  const db = getDb();
  await enforceActionLimit(db, "draft", actor.id);
  const input = editPoSchema.parse(await readJson(req));
  const data = await editPo(db, actor, poIdSchema.parse(params.id), input);
  return NextResponse.json({ success: true, data });
});
