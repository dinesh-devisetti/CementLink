import { NextResponse } from "next/server";
import { adminLinkSchema } from "@/lib/validation/links";
import { enforceActionLimit } from "@/server/auth/action-limit";
import { readJson } from "@/server/auth/http";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { forceLink } from "@/server/services/links";

export const runtime = "nodejs";

export const POST = withAuth<Record<string, never>>(["ADMIN"], async ({ actor, req }) => {
  const db = getDb();
  await enforceActionLimit(db, "link", actor.id);
  const { upperId, lowerId } = adminLinkSchema.parse(await readJson(req));
  const id = await forceLink(db, actor, upperId, lowerId);
  return NextResponse.json({ success: true, data: { id } }, { status: 201 });
});
