import { and, count, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "../db/client";
import { sessions, users, type Role, type UserStatus } from "../db/schema";
import { AppError } from "../errors";

const APPROVABLE_ROLES = ["DISTRIBUTOR", "PROVIDER"] as const;

export interface AdminUserRow {
  id: string;
  name: string;
  email: string;
  role: Role;
  status: UserStatus;
  businessName: string | null;
  city: string | null;
  createdAt: number;
}

const columns = {
  id: users.id,
  name: users.name,
  email: users.email,
  role: users.role,
  status: users.status,
  businessName: users.businessName,
  city: users.city,
  createdAt: users.createdAt,
};

export interface Paging {
  page: number;
  limit: number;
}

/** Distributors and providers with the given status, newest first, one page. Never returns password hashes or phone. */
export async function listUsersByStatus(
  db: Db,
  status: UserStatus,
  { page, limit }: Paging = { page: 1, limit: 50 },
): Promise<{ rows: AdminUserRow[]; total: number }> {
  const where = and(eq(users.status, status), inArray(users.role, [...APPROVABLE_ROLES]));
  const rows = await db
    .select(columns)
    .from(users)
    .where(where)
    .orderBy(desc(users.createdAt), desc(users.id))
    .limit(limit)
    .offset((page - 1) * limit);
  const [{ total }] = await db.select({ total: count() }).from(users).where(where);
  return { rows, total };
}

/**
 * Approve or reject a distributor/provider. Applies to PENDING, and also lets admin
 * re-approve a REJECTED account or revoke an ACTIVE one (API only).
 * Reject deletes the user's sessions so it applies immediately; approve leaves them
 * (a pending user's session simply starts resolving as ACTIVE). Atomic.
 */
export async function decideUser(db: Db, id: string, decision: "approve" | "reject"): Promise<AdminUserRow> {
  const status: UserStatus = decision === "approve" ? "ACTIVE" : "REJECTED";
  return db.transaction(async (tx) => {
    const updated = await tx
      .update(users)
      .set({ status })
      .where(and(eq(users.id, id), inArray(users.role, [...APPROVABLE_ROLES])))
      .returning(columns);
    if (updated.length === 0) {
      const exists = await tx.select({ id: users.id }).from(users).where(eq(users.id, id)).limit(1);
      if (exists.length === 0) throw new AppError("NOT_FOUND", "User not found", 404);
      throw new AppError("INVALID_TARGET", "Only distributor and provider accounts need approval", 409);
    }
    if (decision === "reject") await tx.delete(sessions).where(eq(sessions.userId, id));
    return updated[0];
  });
}
