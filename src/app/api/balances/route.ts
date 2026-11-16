import { NextResponse } from "next/server";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { getBalances } from "@/server/services/balances";

export const runtime = "nodejs";

export const GET = withAuth<Record<string, never>>(["PROVIDER", "DISTRIBUTOR"], async ({ actor }) => {
  return NextResponse.json({ success: true, data: await getBalances(getDb(), actor) });
});
