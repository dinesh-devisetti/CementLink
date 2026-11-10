import { NextResponse } from "next/server";
import { userIdSchema } from "@/lib/validation/admin";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { decideUser } from "@/server/services/admin-users";

export const runtime = "nodejs";

export const POST = withAuth<{ id: string }>(["ADMIN"], async ({ params }) => {
  return NextResponse.json({ success: true, data: await decideUser(getDb(), userIdSchema.parse(params.id), "approve") });
});
