import { and, eq, sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { Db } from "../db/client";
import { AppError } from "../errors";
import { activeLink } from "../db/fragments";
import { assertSql, guardedBatch, isAssertFailure } from "../db/guard";
import { orderAllocations, orders, type OrderStatus, type PoStatus, type User } from "../db/schema";
import type { CreateOrderInput } from "@/lib/validation/orders";
import { partyLabel } from "./party-label";

export interface OrderSummary {
  id: string;
  status: OrderStatus;
  qtyKg: number;
  /** Quantity not allocated to a provider: the distributor's choice. */
  choiceKg: number;
  city: string;
  neededBy: string;
  createdAt: number;
  distributorId: string;
  distributorName: string;
  customerName: string;
}

export interface OrderDetail extends OrderSummary {
  address: string;
  pincode: string;
  rejectReason: string | null;
  allocations: Array<{ providerId: string; providerName: string; qtyKg: number }>;
  customer: { id: string; name: string };
  /** The order's items per PO. Customers never see DRAFT POs and never see rates; provider is null on a draft without one. */
  pos: Array<{ poId: string; status: PoStatus; providerName: string | null; qtyKg: number }>;
}

const CHOICE = sql`(o.qty_kg - COALESCE((SELECT SUM(a.qty_kg) FROM order_allocations a WHERE a.order_id = o.id), 0))`;

/**
 * Create an order (G: guarded batch). Pre-assert: customer and distributor are ACTIVE with an ACTIVE
 * distributor-customer link, and every allocated provider has an ACTIVE link to that distributor (a count match
 * is implied by one activeLink per allocation). Post-assert: SUM(allocations) <= qty and the row count matches.
 */
export async function createOrder(db: Db, actor: User, input: CreateOrderInput, now = Date.now()): Promise<{ id: string; choiceKg: number }> {
  const id = uuidv7();
  const allocSum = input.allocations.reduce((s, a) => s + a.qtyKg, 0);
  const providerGate = input.allocations.map((a) => sql`${activeLink(a.providerId, input.distributorId, "PROVIDER_DISTRIBUTOR")}`);
  const gate = sql.join([sql`${activeLink(input.distributorId, actor.id, "DISTRIBUTOR_CUSTOMER")}`, ...providerGate], sql` AND `);
  try {
    await guardedBatch(db, [
      assertSql(gate),
      db.insert(orders).values({
        id, customerId: actor.id, distributorId: input.distributorId, qtyKg: input.qtyKg,
        address: input.address, city: input.city, pincode: input.pincode, neededBy: input.neededBy,
        status: "REQUESTED", createdAt: now, updatedAt: now,
      }),
      ...input.allocations.map((a) =>
        db.insert(orderAllocations).values({ id: uuidv7(), orderId: id, providerId: a.providerId, qtyKg: a.qtyKg, createdAt: now }),
      ),
      // Post-conditions read back from the database, never from JS constants.
      assertSql(sql`(SELECT COALESCE(SUM(qty_kg), 0) FROM order_allocations WHERE order_id = ${id}) <= (SELECT qty_kg FROM orders WHERE id = ${id})
        AND (SELECT count(*) FROM order_allocations WHERE order_id = ${id}) = ${input.allocations.length}`),
    ]);
  } catch (e) {
    if (isAssertFailure(e)) await diagnoseCreate(db, actor, input);
    throw e;
  }
  return { id, choiceKg: input.qtyKg - allocSum };
}

async function diagnoseCreate(db: Db, actor: User, input: CreateOrderInput): Promise<never> {
  const [d] = await db.all<{ ok: number }>(sql`SELECT (${activeLink(input.distributorId, actor.id, "DISTRIBUTOR_CUSTOMER")}) AS ok`);
  if (!d?.ok) throw new AppError("NOT_LINKED", "You are not linked to this distributor", 403);
  for (const a of input.allocations) {
    const [p] = await db.all<{ ok: number }>(sql`SELECT (${activeLink(a.providerId, input.distributorId, "PROVIDER_DISTRIBUTOR")}) AS ok`);
    if (!p?.ok) throw new AppError("PROVIDER_NOT_LINKED", "A chosen provider is not linked to this distributor", 422);
  }
  throw new AppError("CONFLICT", "Could not place the order, please retry", 409);
}

/** Customer cancels its own order while REQUESTED (C). */
export async function cancelOrder(db: Db, actor: User, orderId: string, now = Date.now()): Promise<void> {
  const res = await db.run(sql`
    UPDATE orders SET status = 'CANCELLED', cancelled_at = ${now}, updated_at = ${now}
    WHERE id = ${orderId} AND customer_id = ${actor.id} AND status = 'REQUESTED'`);
  if (res.rowsAffected > 0) return;
  const [row] = await db.select({ status: orders.status }).from(orders).where(and(eq(orders.id, orderId), eq(orders.customerId, actor.id)));
  if (!row) throw new AppError("NOT_FOUND", "Order not found", 404);
  throw new AppError("INVALID_STATE", `Order is ${row.status.toLowerCase().replace("_", " ")}, only a requested order can be cancelled`, 409);
}

interface RawOrder {
  id: string;
  status: OrderStatus;
  qty_kg: number;
  choice_kg: number;
  city: string;
  address: string;
  pincode: string;
  needed_by: string;
  reject_reason: string | null;
  created_at: number;
  distributor_id: string;
  d_business: string | null;
  customer_id: string;
  c_name: string;
  c_business: string | null;
}

const SELECT = sql`SELECT o.id, o.status, o.qty_kg, ${CHOICE} AS choice_kg, o.city, o.address, o.pincode, o.needed_by, o.reject_reason, o.created_at,
    o.distributor_id, d.business_name AS d_business, o.customer_id, c.name AS c_name, c.business_name AS c_business
  FROM orders o JOIN users d ON d.id = o.distributor_id JOIN users c ON c.id = o.customer_id`;

/** The distributor of an order is the counterparty of the customer's link row, so it may see the customer's own name. */
function toSummary(r: RawOrder, actor: User): OrderSummary {
  return {
    id: r.id, status: r.status, qtyKg: r.qty_kg, choiceKg: r.choice_kg, city: r.city, neededBy: r.needed_by, createdAt: r.created_at,
    distributorId: r.distributor_id,
    distributorName: partyLabel(r.d_business, "DISTRIBUTOR", r.distributor_id),
    customerName: partyLabel(r.c_business, "CUSTOMER", r.customer_id, actor.role === "DISTRIBUTOR" ? r.c_name : null),
  };
}

const scope = (actor: User) => (actor.role === "CUSTOMER" ? sql`o.customer_id = ${actor.id}` : sql`o.distributor_id = ${actor.id}`);

/** Own orders (customer) or orders addressed to the caller (distributor), newest first. */
export async function listOrders(
  db: Db,
  actor: User,
  opts: { status?: OrderStatus; page: number; limit: number },
): Promise<{ rows: OrderSummary[]; total: number }> {
  const status = opts.status ? sql`AND o.status = ${opts.status}` : sql``;
  const rows = await db.all<RawOrder>(
    sql`${SELECT} WHERE ${scope(actor)} ${status} ORDER BY o.created_at DESC, o.id DESC LIMIT ${opts.limit} OFFSET ${(opts.page - 1) * opts.limit}`,
  );
  const [t] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM orders o WHERE ${scope(actor)} ${status}`);
  return { rows: rows.map((r) => toSummary(r, actor)), total: Number(t?.n ?? 0) };
}

/** One order with its allocations. Out-of-scope ids are 404. */
export async function getOrder(db: Db, actor: User, orderId: string): Promise<OrderDetail> {
  const [r] = await db.all<RawOrder>(sql`${SELECT} WHERE o.id = ${orderId} AND ${scope(actor)}`);
  if (!r) throw new AppError("NOT_FOUND", "Order not found", 404);
  const allocs = await db.all<{ provider_id: string; business_name: string | null; qty_kg: number }>(
    sql`SELECT a.provider_id, p.business_name, a.qty_kg FROM order_allocations a JOIN users p ON p.id = a.provider_id
        WHERE a.order_id = ${orderId} ORDER BY a.created_at, a.id`,
  );
  const hide = actor.role === "CUSTOMER" ? sql`AND p.status NOT IN ('DRAFT','REJECTED')` : sql`AND p.status <> 'REJECTED'`;
  const pos = await db.all<{ po_id: string; status: PoStatus; provider_id: string | null; business_name: string | null; qty_kg: number }>(
    sql`SELECT p.id AS po_id, p.status, p.provider_id, u.business_name, i.qty_kg FROM po_items i
        JOIN purchase_orders p ON p.id = i.po_id LEFT JOIN users u ON u.id = p.provider_id
        WHERE i.order_id = ${orderId} ${hide} ORDER BY p.created_at, p.id`,
  );
  const summary = toSummary(r, actor);
  return {
    ...summary,
    address: r.address, pincode: r.pincode, rejectReason: r.reject_reason,
    allocations: allocs.map((a) => ({ providerId: a.provider_id, providerName: partyLabel(a.business_name, "PROVIDER", a.provider_id), qtyKg: a.qty_kg })),
    customer: { id: r.customer_id, name: summary.customerName },
    pos: pos.map((x) => ({
      poId: x.po_id, status: x.status, qtyKg: x.qty_kg,
      providerName: x.provider_id ? partyLabel(x.business_name, "PROVIDER", x.provider_id) : null,
    })),
  };
}
