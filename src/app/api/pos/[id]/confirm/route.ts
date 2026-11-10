import { NextResponse } from "next/server";
import { requestIdSchema } from "@/lib/validation/requests";
import { enforceActionLimit } from "@/server/auth/action-limit";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { decidePo } from "@/server/services/pos";

export const runtime = "nodejs";

export const POST = withAuth<{ id: string }>(["PROVIDER"], async ({ actor, params }) => {
  const db = getDb();
  await enforceActionLimit(db, "po:decide", actor.id);
  await decidePo(db, actor.id, requestIdSchema.parse(params.id), "CONFIRMED");
  return NextResponse.json({ success: true });
});
