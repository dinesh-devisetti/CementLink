import { NextResponse } from "next/server";
import { acceptLineSchema } from "@/lib/validation/lines";
import { requestIdSchema } from "@/lib/validation/requests";
import { enforceActionLimit } from "@/server/auth/action-limit";
import { readJson } from "@/server/auth/http";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { acceptLine } from "@/server/services/lines";

export const runtime = "nodejs";

export const POST = withAuth<{ id: string }>(["DISTRIBUTOR"], async ({ actor, req, params }) => {
  const db = getDb();
  await enforceActionLimit(db, "line:decide", actor.id);
  const id = requestIdSchema.parse(params.id);
  const { pricePerBagPaise } = acceptLineSchema.parse(await readJson(req));
  await acceptLine(db, actor.id, id, pricePerBagPaise);
  return NextResponse.json({ success: true });
});
