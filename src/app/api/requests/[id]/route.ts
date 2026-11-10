import { NextResponse } from "next/server";
import { requestIdSchema } from "@/lib/validation/requests";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { getRequest } from "@/server/services/requests";

export const runtime = "nodejs";

export const GET = withAuth<{ id: string }>(["CUSTOMER"], async ({ actor, params }) => {
  const data = await getRequest(getDb(), actor.id, requestIdSchema.parse(params.id));
  if (!data) throw new AppError("NOT_FOUND", "Request not found", 404);
  return NextResponse.json({ success: true, data });
});
