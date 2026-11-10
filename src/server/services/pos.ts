import { and, count, desc, eq, sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import type { Db } from "../db/client";
import { purchaseOrders, users, type PoStatus } from "../db/schema";
import { AppError } from "../errors";
import { demandSummary } from "./lines";

export interface PoView {
  id: string;
  /** Provider's name (distributor view) or distributor's name (provider view). */
  counterparty: string;
  qtyBags: number;
  ratePerBagPaise: number;
  totalPaise: number;
  status: PoStatus;
  createdAt: number;
}

export interface ProviderOption {
  id: string;
  businessName: string;
  city: string | null;
}

export interface CreatedPo {
  id: string;
  totalPaise: number;
  status: "PLACED";
  /** Bags above unfulfilled accepted demand (0 = within demand). Informational only. */
  overOrderBags: number;
}

const activeUser = (id: string, role: "DISTRIBUTOR" | "PROVIDER") =>
  sql`exists (select 1 from ${users} where ${users.id} = ${id} and ${users.role} = ${role} and ${users.status} = 'ACTIVE')`;

/** Accepted demand minus bags already ordered on non-rejected POs (can be negative: stocked ahead). */
export async function unfulfilledBags(db: Db, distributorId: string): Promise<number> {
  const { acceptedBags } = await demandSummary(db, distributorId);
  const [row] = await db
    .select({ n: sql<number>`coalesce(sum(${purchaseOrders.qtyBags}), 0)` })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.distributorId, distributorId), sql`${purchaseOrders.status} <> 'REJECTED'`));
  return acceptedBags - Number(row.n);
}

export async function listActiveProviders(db: Db): Promise<ProviderOption[]> {
  const rows = await db
    .select({ id: users.id, businessName: users.businessName, name: users.name, city: users.city })
    .from(users)
    .where(and(eq(users.role, "PROVIDER"), eq(users.status, "ACTIVE")))
    .orderBy(users.businessName, users.id);
  return rows.map((r) => ({ id: r.id, businessName: r.businessName ?? r.name, city: r.city }));
}

/** One conditional INSERT...SELECT: only when both distributor and provider are ACTIVE. Total is computed in SQL. */
export async function createPo(
  db: Db,
  distributorId: string,
  input: { providerId: string; qtyBags: number; ratePerBagPaise: number },
  now: number = Date.now(),
): Promise<CreatedPo> {
  const { providerId, qtyBags, ratePerBagPaise } = input;
  const open = await unfulfilledBags(db, distributorId);
  const id = uuid();
  const res = await db.run(sql`
    insert into purchase_orders (id, distributor_id, provider_id, qty_bags, rate_per_bag_paise, total_paise, status, created_at)
    select ${id}, ${distributorId}, ${providerId}, ${qtyBags}, ${ratePerBagPaise}, ${qtyBags} * ${ratePerBagPaise}, 'PLACED', ${now}
    where ${activeUser(distributorId, "DISTRIBUTOR")} and ${activeUser(providerId, "PROVIDER")}`);
  if (res.rowsAffected !== 1) {
    const [p] = await db
      .select({ id: users.id })
      .from(users)
      .where(and(eq(users.id, providerId), eq(users.role, "PROVIDER"), eq(users.status, "ACTIVE")))
      .limit(1);
    if (!p) throw new AppError("INVALID_PROVIDER", "Choose an approved provider", 422);
    throw new AppError("FORBIDDEN", "Your account is not active", 403);
  }
  return { id, totalPaise: qtyBags * ratePerBagPaise, status: "PLACED", overOrderBags: Math.max(0, qtyBags - Math.max(0, open)) };
}

/** Own POs only: distributor sees the ones it placed, provider the ones received. */
export async function listPos(
  db: Db,
  actor: { id: string; role: "DISTRIBUTOR" | "PROVIDER" },
  { page, limit }: { page: number; limit: number },
): Promise<{ rows: PoView[]; total: number }> {
  const isDist = actor.role === "DISTRIBUTOR";
  const own = eq(isDist ? purchaseOrders.distributorId : purchaseOrders.providerId, actor.id);
  const other = isDist ? purchaseOrders.providerId : purchaseOrders.distributorId;
  const rows = await db
    .select({
      id: purchaseOrders.id,
      businessName: users.businessName,
      name: users.name,
      qtyBags: purchaseOrders.qtyBags,
      ratePerBagPaise: purchaseOrders.ratePerBagPaise,
      totalPaise: purchaseOrders.totalPaise,
      status: purchaseOrders.status,
      createdAt: purchaseOrders.createdAt,
    })
    .from(purchaseOrders)
    .innerJoin(users, eq(users.id, other))
    .where(own)
    .orderBy(desc(purchaseOrders.createdAt), desc(purchaseOrders.id))
    .limit(limit)
    .offset((page - 1) * limit);
  const [{ total }] = await db.select({ total: count() }).from(purchaseOrders).where(own);
  return {
    rows: rows.map(({ businessName, name, ...r }) => ({ ...r, counterparty: businessName ?? name })),
    total,
  };
}

export interface ProviderSummary {
  ordersReceived: number;
  awaitingReply: number;
  confirmedBags: number;
}

export async function providerSummary(db: Db, providerId: string): Promise<ProviderSummary> {
  const [r] = await db
    .select({
      ordersReceived: count(),
      awaitingReply: sql<number>`coalesce(sum(case when ${purchaseOrders.status} = 'PLACED' then 1 else 0 end), 0)`,
      confirmedBags: sql<number>`coalesce(sum(case when ${purchaseOrders.status} = 'CONFIRMED' then ${purchaseOrders.qtyBags} else 0 end), 0)`,
    })
    .from(purchaseOrders)
    .where(eq(purchaseOrders.providerId, providerId));
  return { ordersReceived: r.ordersReceived, awaitingReply: Number(r.awaitingReply), confirmedBags: Number(r.confirmedBags) };
}

/** PLACED -> CONFIRMED/REJECTED in a single conditional UPDATE (own PO, provider still ACTIVE). */
export async function decidePo(db: Db, providerId: string, poId: string, to: "CONFIRMED" | "REJECTED"): Promise<void> {
  const res = await db
    .update(purchaseOrders)
    .set({ status: to })
    .where(
      and(
        eq(purchaseOrders.id, poId),
        eq(purchaseOrders.providerId, providerId),
        eq(purchaseOrders.status, "PLACED"),
        activeUser(providerId, "PROVIDER"),
      ),
    );
  if (res.rowsAffected === 1) return;
  const [row] = await db
    .select({ status: purchaseOrders.status })
    .from(purchaseOrders)
    .where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.providerId, providerId)))
    .limit(1);
  if (!row) throw new AppError("NOT_FOUND", "Order not found", 404);
  if (row.status !== "PLACED") throw new AppError("INVALID_STATE", `Order is already ${row.status.toLowerCase()}`, 409);
  throw new AppError("FORBIDDEN", "Your account is not active", 403);
}
