import { NextResponse } from "next/server";
import { poIdSchema } from "@/lib/validation/drafts";
import { dispatchSchema } from "@/lib/validation/po-lifecycle";
import { enforceActionLimit } from "@/server/auth/action-limit";
import { readJson } from "@/server/auth/http";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { dispatchPo } from "@/server/services/po-provider";

export const runtime = "nodejs";

export const POST = withAuth<{ id: string }>(["PROVIDER"], async ({ actor, req, params }) => {
  const db = getDb();
  await enforceActionLimit(db, "po", actor.id);
  const input = dispatchSchema.parse(await readJson(req));
  const data = await dispatchPo(db, actor, poIdSchema.parse(params.id), input);
  return NextResponse.json({ success: true, data }, { status: 201 });
});
