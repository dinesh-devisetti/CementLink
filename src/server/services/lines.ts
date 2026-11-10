import { and, count, desc, eq, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { requestLines, requests, users, type LineStatus } from "../db/schema";
import { AppError } from "../errors";

/** Statuses that count as committed demand (accepted, awaiting payment, or paid). */
export const DEMAND_STATUSES: readonly LineStatus[] = ["ACCEPTED", "PAYMENT_PENDING", "PAID"];

/** Only the fields a distributor needs: no customer email/phone, no street address. */
export interface DistributorLineView {
  id: string;
  customerName: string;
  city: string;
  pincode: string;
  neededBy: string;
  qtyBags: number;
  status: LineStatus;
  pricePerBagPaise: number | null;
  amountPaise: number | null;
  createdAt: number;
}

export interface DemandSummary {
  acceptedBags: number;
  awaitingReply: number;
}

const idOf = (actorId: string) => eq(requestLines.distributorId, actorId);

export async function listLines(
  db: Db,
  distributorId: string,
  { status, page, limit }: { status?: LineStatus; page: number; limit: number },
): Promise<{ rows: DistributorLineView[]; total: number }> {
  const where = status ? and(idOf(distributorId), eq(requestLines.status, status)) : idOf(distributorId);
  const rows = await db
    .select({
      id: requestLines.id,
      customerName: users.name,
      city: requests.city,
      pincode: requests.pincode,
      neededBy: requests.neededBy,
      qtyBags: requestLines.qtyBags,
      status: requestLines.status,
      pricePerBagPaise: requestLines.pricePerBagPaise,
      amountPaise: requestLines.amountPaise,
      createdAt: requests.createdAt,
    })
    .from(requestLines)
    .innerJoin(requests, eq(requests.id, requestLines.requestId))
    .innerJoin(users, eq(users.id, requests.customerId))
    .where(where)
    .orderBy(desc(requests.createdAt), desc(requestLines.id))
    .limit(limit)
    .offset((page - 1) * limit);
  const [{ total }] = await db.select({ total: count() }).from(requestLines).where(where);
  return { rows, total };
}

export async function demandSummary(db: Db, distributorId: string): Promise<DemandSummary> {
  const [row] = await db
    .select({
      acceptedBags: sql<number>`coalesce(sum(case when ${requestLines.status} in ('ACCEPTED','PAYMENT_PENDING','PAID') then ${requestLines.qtyBags} else 0 end), 0)`,
      awaitingReply: sql<number>`coalesce(sum(case when ${requestLines.status} = 'SENT' then 1 else 0 end), 0)`,
    })
    .from(requestLines)
    .where(idOf(distributorId));
  return { acceptedBags: Number(row.acceptedBags), awaitingReply: Number(row.awaitingReply) };
}

async function failTransition(db: Db, distributorId: string, lineId: string): Promise<never> {
  const [row] = await db
    .select({ status: requestLines.status })
    .from(requestLines)
    .where(and(eq(requestLines.id, lineId), idOf(distributorId)))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "Line not found", 404);
  if (row.status !== "SENT") throw new AppError("INVALID_STATE", `Line is already ${row.status.toLowerCase().replace(/_/g, " ")}`, 409);
  // Still SENT but the update matched nothing: distributor is no longer ACTIVE.
  throw new AppError("FORBIDDEN", "Your account is not active", 403);
}

const activeDistributor = (id: string) =>
  sql`exists (select 1 from ${users} where ${users.id} = ${id} and ${users.role} = 'DISTRIBUTOR' and ${users.status} = 'ACTIVE')`;

/** SENT -> ACCEPTED in a single conditional UPDATE (race-safe); amount computed server-side. */
export async function acceptLine(
  db: Db,
  distributorId: string,
  lineId: string,
  pricePerBagPaise: number,
  now: number = Date.now(),
): Promise<void> {
  if (!Number.isSafeInteger(pricePerBagPaise) || pricePerBagPaise <= 0) {
    throw new AppError("VALIDATION", "Price must be positive", 400);
  }
  const res = await db
    .update(requestLines)
    .set({
      status: "ACCEPTED",
      pricePerBagPaise,
      amountPaise: sql`${requestLines.qtyBags} * ${pricePerBagPaise}`,
      acceptedAt: now,
    })
    .where(
      and(eq(requestLines.id, lineId), idOf(distributorId), eq(requestLines.status, "SENT"), activeDistributor(distributorId)),
    );
  if (res.rowsAffected !== 1) await failTransition(db, distributorId, lineId);
}

/** SENT -> REJECTED in a single conditional UPDATE. */
export async function rejectLine(db: Db, distributorId: string, lineId: string): Promise<void> {
  const res = await db
    .update(requestLines)
    .set({ status: "REJECTED" })
    .where(
      and(eq(requestLines.id, lineId), idOf(distributorId), eq(requestLines.status, "SENT"), activeDistributor(distributorId)),
    );
  if (res.rowsAffected !== 1) await failTransition(db, distributorId, lineId);
}

