import { NextResponse } from "next/server";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { listActiveProviders } from "@/server/services/pos";

export const runtime = "nodejs";

export const GET = withAuth<Record<string, never>>(["DISTRIBUTOR"], async () => {
  return NextResponse.json({ success: true, data: await listActiveProviders(getDb()) });
});
