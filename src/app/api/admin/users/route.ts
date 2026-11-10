import { NextResponse } from "next/server";
import { z } from "zod";
import { withAuth } from "@/server/auth/with-auth";
import { getDb } from "@/server/db/client";
import { listUsersByStatus } from "@/server/services/admin-users";

export const runtime = "nodejs";

const querySchema = z.object({
  status: z.enum(["PENDING", "ACTIVE", "REJECTED"]).default("PENDING"),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  limit: z.coerce.number().int().min(1).max(50).default(50),
});

export const GET = withAuth<Record<string, never>>(["ADMIN"], async ({ req }) => {
  const sp = new URL(req.url).searchParams;
  const q = querySchema.parse({
    status: sp.get("status") ?? undefined,
    page: sp.get("page") ?? undefined,
    limit: sp.get("limit") ?? undefined,
  });
  const { rows, total } = await listUsersByStatus(getDb(), q.status, { page: q.page, limit: q.limit });
  return NextResponse.json({ success: true, data: rows, meta: { total, page: q.page, limit: q.limit } });
});
