import { NextResponse } from "next/server";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { listActiveDistributors } from "@/server/services/requests";

export const runtime = "nodejs";

export const GET = withAuth<Record<string, never>>(["CUSTOMER"], async () => {
  return NextResponse.json({ success: true, data: await listActiveDistributors(getDb()) });
});
