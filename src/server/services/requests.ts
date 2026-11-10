import { and, count, desc, eq, inArray } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import type { Db } from "../db/client";
import { requestLines, requests, users, type LineStatus } from "../db/schema";
import { AppError } from "../errors";

export interface DistributorOption {
  id: string;
  businessName: string | null;
  city: string | null;
}

export interface RequestLineView {
  id: string;
  distributorId: string;
  distributorName: string;
  qtyBags: number;
  status: LineStatus;
  pricePerBagPaise: number | null;
  amountPaise: number | null;
}

export interface RequestView {
  id: string;
  totalBags: number;
  address: string;
  city: string;
  pincode: string;
  neededBy: string;
  createdAt: number;
  lines: RequestLineView[];
}

export interface CreateRequestInput {
  totalBags: number;
  address: string;
  city: string;
  pincode: string;
  neededBy: string;
  allocations: ReadonlyArray<{ distributorId: string; bags: number }>;
}

/** ACTIVE distributors only; exposes id, business name and city, never contact data. */
export async function listActiveDistributors(db: Db): Promise<DistributorOption[]> {
  return db
    .select({ id: users.id, businessName: users.businessName, city: users.city })
    .from(users)
    .where(and(eq(users.role, "DISTRIBUTOR"), eq(users.status, "ACTIVE")))
    .orderBy(users.businessName, users.id);
}

async function linesFor(db: Db, requestIds: string[]): Promise<Map<string, RequestLineView[]>> {
  const out = new Map<string, RequestLineView[]>();
  if (requestIds.length === 0) return out;
  const rows = await db
    .select({
      requestId: requestLines.requestId,
      id: requestLines.id,
      distributorId: requestLines.distributorId,
      businessName: users.businessName,
      qtyBags: requestLines.qtyBags,
      status: requestLines.status,
      pricePerBagPaise: requestLines.pricePerBagPaise,
      amountPaise: requestLines.amountPaise,
    })
    .from(requestLines)
    .innerJoin(users, eq(users.id, requestLines.distributorId))
    .where(inArray(requestLines.requestId, requestIds))
    .orderBy(requestLines.id);
  for (const r of rows) {
    const list = out.get(r.requestId) ?? [];
    out.set(r.requestId, [
      ...list,
      {
        id: r.id,
        distributorId: r.distributorId,
        distributorName: r.businessName ?? "Distributor",
        qtyBags: r.qtyBags,
        status: r.status,
        pricePerBagPaise: r.pricePerBagPaise,
        amountPaise: r.amountPaise,
      },
    ]);
  }
  return out;
}

/** Creates the request and one SENT line per distributor atomically. */
export async function createRequest(
  db: Db,
  customerId: string,
  input: CreateRequestInput,
  now: number = Date.now(),
): Promise<RequestView> {
  const ids = input.allocations.map((a) => a.distributorId);
  if (new Set(ids).size !== ids.length) throw new AppError("VALIDATION", "Duplicate distributor", 400);
  if (input.allocations.reduce((s, a) => s + a.bags, 0) !== input.totalBags) {
    throw new AppError("VALIDATION", "Allocations must add up to the total", 400);
  }
  const requestId = uuid();
  // Check distributors, then write request + lines as ONE batch (atomic, no await while a write lock is held).
  // An interactive transaction would hold SQLite's write lock across awaits; with the synchronous local driver a
  // concurrent request then blocks the event loop on that lock and deadlocks (SQLITE_BUSY).
  const ok = await db
    .select({ id: users.id })
    .from(users)
    .where(and(inArray(users.id, ids), eq(users.role, "DISTRIBUTOR"), eq(users.status, "ACTIVE")));
  if (ok.length !== ids.length) {
    throw new AppError("INVALID_DISTRIBUTOR", "Pick only available distributors", 422);
  }
  await db.batch([
    db.insert(requests).values({
      id: requestId,
      customerId,
      totalBags: input.totalBags,
      address: input.address,
      city: input.city,
      pincode: input.pincode,
      neededBy: input.neededBy,
      createdAt: now,
    }),
    db.insert(requestLines).values(
      input.allocations.map((a) => ({
        id: uuid(),
        requestId,
        distributorId: a.distributorId,
        qtyBags: a.bags,
        status: "SENT" as const,
      })),
    ),
  ]);
  const view = await getRequest(db, customerId, requestId);
  if (!view) throw new AppError("INTERNAL", "Request not saved", 500);
  return view;
}

/** Scoped to the customer: another customer's id returns null (caller maps to 404). */
export async function getRequest(db: Db, customerId: string, id: string): Promise<RequestView | null> {
  const [row] = await db
    .select()
    .from(requests)
    .where(and(eq(requests.id, id), eq(requests.customerId, customerId)))
    .limit(1);
  if (!row) return null;
  const lines = await linesFor(db, [row.id]);
  return toView(row, lines.get(row.id) ?? []);
}

export async function listRequests(
  db: Db,
  customerId: string,
  { page, limit }: { page: number; limit: number },
): Promise<{ rows: RequestView[]; total: number }> {
  const where = eq(requests.customerId, customerId);
  const rows = await db
    .select()
    .from(requests)
    .where(where)
    .orderBy(desc(requests.createdAt), desc(requests.id))
    .limit(limit)
    .offset((page - 1) * limit);
  const [{ total }] = await db.select({ total: count() }).from(requests).where(where);
  const lines = await linesFor(db, rows.map((r) => r.id));
  return { rows: rows.map((r) => toView(r, lines.get(r.id) ?? [])), total };
}

function toView(r: typeof requests.$inferSelect, lines: RequestLineView[]): RequestView {
  return {
    id: r.id,
    totalBags: r.totalBags,
    address: r.address,
    city: r.city,
    pincode: r.pincode,
    neededBy: r.neededBy,
    createdAt: r.createdAt,
    lines,
  };
}
