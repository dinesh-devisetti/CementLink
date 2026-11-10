import { NextResponse } from "next/server";
import { errorResponse, getActor } from "@/server/auth/guards";
import { toPublicUser } from "@/server/services/users";

export const runtime = "nodejs";

export async function GET() {
  const actor = await getActor();
  if (!actor) return errorResponse(401, "UNAUTHENTICATED", "Not signed in");
  return NextResponse.json({ success: true, data: toPublicUser(actor) });
}
