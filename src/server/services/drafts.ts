import { sql, type SQL } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { Db } from "../db/client";
import { AppError } from "../errors";
import { activeLink, activeUser } from "../db/fragments";
import { assertSql, guardedBatch, isAssertFailure } from "../db/guard";
import { poItems, purchaseOrders } from "../db/schema";
import type { User } from "../db/schema";
import type { EditPoInput } from "@/lib/validation/drafts";

const STALE = () => new AppError("STALE", "This draft changed. Refresh and try again", 409);
const NOT_DRAFT = () => new AppError("INVALID_STATE", "Only a draft can be changed", 409);
const NOT_LINKED = () => new AppError("PROVIDER_NOT_LINKED", "That provider is not linked to you", 422);

const COVERAGE = (orderId: string) =>
  sql`(SELECT COALESCE(SUM(i.qty_kg), 0) FROM po_items i JOIN purchase_orders p ON p.id = i.po_id WHERE i.order_id = ${orderId} AND p.status <> 'REJECTED')`;

/**
 * Open an order (G): REQUESTED -> UNDER_REVIEW and create its drafts in the same batch, exactly once.
 * Only one batch can pass the REQUESTED guard and UNIQUE(seed_key) rolls back any re-run. Opening an
 * already-opened order is a no-op (`opened: false`).
 */
export async function openOrder(db: Db, actor: User, orderId: string, now = Date.now()): Promise<{ opened: boolean }> {
  const o = await readOrder(db, actor, orderId);
  if (o.status !== "REQUESTED") return skipOpen(o.status);
  const allocs = await db.all<{ provider_id: string; qty_kg: number }>(
    sql`SELECT provider_id, qty_kg FROM order_allocations WHERE order_id = ${orderId} ORDER BY created_at, id`,
  );
  const choiceKg = o.qty_kg - allocs.reduce((s, a) => s + a.qty_kg, 0);
  const drafts = [
    ...allocs.map((a) => ({ providerId: a.provider_id as string | null, qtyKg: a.qty_kg, seedKey: `${orderId}:${a.provider_id}` })),
    ...(choiceKg > 0 ? [{ providerId: null, qtyKg: choiceKg, seedKey: `${orderId}:choice` }] : []),
  ].map((d) => ({ ...d, poId: uuidv7(), itemId: uuidv7() }));
  try {
    await guardedBatch(db, [
      assertSql(sql`EXISTS (SELECT 1 FROM orders WHERE id = ${orderId} AND distributor_id = ${actor.id} AND status = 'REQUESTED') AND ${activeUser(actor.id)}`),
      sql`UPDATE orders SET status = 'UNDER_REVIEW', opened_at = ${now}, updated_at = ${now} WHERE id = ${orderId}`,
      ...drafts.flatMap((d) => [
        db.insert(purchaseOrders).values({ id: d.poId, distributorId: actor.id, providerId: d.providerId, status: "DRAFT", version: 0, createdAt: now, updatedAt: now }),
        db.insert(poItems).values({ id: d.itemId, poId: d.poId, orderId, distributorId: actor.id, qtyKg: d.qtyKg, seedKey: d.seedKey, createdAt: now }),
      ]),
      assertSql(sql`${COVERAGE(orderId)} = (SELECT qty_kg FROM orders WHERE id = ${orderId})`),
    ]);
  } catch (e) {
    // A concurrent open that won the race (or a seed_key re-run) leaves the order opened: that is success.
    const now2 = await readOrder(db, actor, orderId);
    if (now2.status !== "REQUESTED") return skipOpen(now2.status);
    const [u] = await db.all<{ ok: number }>(sql`SELECT (${activeUser(actor.id)}) AS ok`);
    if (!u?.ok) throw new AppError("FORBIDDEN", "Your account is not active", 403);
    throw isAssertFailure(e) ? new AppError("CONFLICT", "Could not open the order, please retry", 409) : e;
  }
  return { opened: true };
}

/** Open on a non-REQUESTED order: already opened is an idempotent no-op, a cancelled or rejected order is 409. */
function skipOpen(status: string): { opened: false } {
  if (status === "CANCELLED" || status === "REJECTED") {
    throw new AppError("INVALID_STATE", `Order is ${status.toLowerCase()}, it cannot be opened`, 409);
  }
  return { opened: false };
}

async function readOrder(db: Db, actor: User, orderId: string): Promise<{ status: string; qty_kg: number }> {
  const [o] = await db.all<{ status: string; qty_kg: number }>(sql`SELECT status, qty_kg FROM orders WHERE id = ${orderId} AND distributor_id = ${actor.id}`);
  if (!o) throw new AppError("NOT_FOUND", "Order not found", 404);
  return o;
}

/**
 * Reject an order (G) while REQUESTED or UNDER_REVIEW with no live item in a placed PO. Its items leave the DRAFT
 * POs (versions bumped so open editors go stale) and now-empty drafts are deleted.
 */
export async function rejectOrder(db: Db, actor: User, orderId: string, reason: string, now = Date.now()): Promise<void> {
  await readOrder(db, actor, orderId);
  // Read this order's DRAFT POs first and scope every write to exactly those ids; the post-assert catches a draft created in between.
  const mine = await db.all<{ id: string }>(sql`SELECT DISTINCT p.id FROM po_items i JOIN purchase_orders p ON p.id = i.po_id
    WHERE i.order_id = ${orderId} AND p.status = 'DRAFT' AND p.distributor_id = ${actor.id}`);
  const ids = sql`(${sql.join(mine.map((m) => sql`${m.id}`), sql`, `)})`;
  const draftWrites = mine.length === 0 ? [] : [
    sql`UPDATE purchase_orders SET version = version + 1, updated_at = ${now} WHERE id IN ${ids} AND status = 'DRAFT'`,
    sql`DELETE FROM po_items WHERE order_id = ${orderId} AND po_id IN ${ids}`,
    sql`DELETE FROM purchase_orders WHERE id IN ${ids} AND status = 'DRAFT' AND NOT EXISTS (SELECT 1 FROM po_items WHERE po_id = purchase_orders.id)`,
  ];
  try {
    await guardedBatch(db, [
      assertSql(sql`EXISTS (SELECT 1 FROM orders WHERE id = ${orderId} AND distributor_id = ${actor.id} AND status IN ('REQUESTED','UNDER_REVIEW'))
        AND NOT EXISTS (SELECT 1 FROM po_items i JOIN purchase_orders p ON p.id = i.po_id WHERE i.order_id = ${orderId} AND p.status NOT IN ('DRAFT','REJECTED'))`),
      ...draftWrites,
      sql`UPDATE orders SET status = 'REJECTED', reject_reason = ${reason}, updated_at = ${now} WHERE id = ${orderId}`,
      assertSql(sql`(SELECT status FROM orders WHERE id = ${orderId}) = 'REJECTED' AND NOT EXISTS (SELECT 1 FROM po_items i JOIN purchase_orders p ON p.id = i.po_id WHERE i.order_id = ${orderId} AND p.status = 'DRAFT')`),
    ]);
  } catch (e) {
    if (!isAssertFailure(e)) throw e;
    const cur = await readOrder(db, actor, orderId);
    throw new AppError("INVALID_STATE", `Order is ${cur.status.toLowerCase().replace(/_/g, " ")}, it can no longer be rejected`, 409);
  }
}

/** Edit a draft PO's provider and/or optional rate (C: one conditional UPDATE with the version check). */
export async function editPo(db: Db, actor: User, poId: string, input: EditPoInput, now = Date.now()): Promise<{ version: number }> {
  const sets: SQL[] = [
    sql`version = version + 1`,
    sql`updated_at = ${now}`,
    ...(input.providerId !== undefined ? [sql`provider_id = ${input.providerId}`] : []),
    ...(input.ratePerTonne !== undefined ? [sql`rate_per_tonne_paise = ${input.ratePerTonne}`] : []),
  ];
  const gate = input.providerId ? activeLink(input.providerId, actor.id, "PROVIDER_DISTRIBUTOR") : sql`1`;
  const res = await db.run(sql`UPDATE purchase_orders SET ${sql.join(sets, sql`, `)}
    WHERE id = ${poId} AND distributor_id = ${actor.id} AND status = 'DRAFT' AND version = ${input.version} AND ${gate}`);
  if (res.rowsAffected > 0) return { version: input.version + 1 };
  const po = await readPo(db, actor, poId);
  if (po.status !== "DRAFT") throw NOT_DRAFT();
  if (po.version !== input.version) throw STALE();
  if (input.providerId) throw NOT_LINKED();
  throw new AppError("CONFLICT", "Could not change the draft, please retry", 409);
}

async function readPo(db: Db, actor: User, poId: string): Promise<{ status: string; version: number }> {
  const [po] = await db.all<{ status: string; version: number }>(sql`SELECT status, version FROM purchase_orders WHERE id = ${poId} AND distributor_id = ${actor.id}`);
  if (!po) throw new AppError("NOT_FOUND", "Draft not found", 404);
  return po;
}

interface ItemRow {
  po_id: string;
  order_id: string;
  qty_kg: number;
  status: string;
  version: number;
}
async function readItem(db: Db, actor: User, itemId: string): Promise<ItemRow> {
  const [r] = await db.all<ItemRow>(sql`SELECT i.po_id, i.order_id, i.qty_kg, p.status, p.version FROM po_items i JOIN purchase_orders p ON p.id = i.po_id
    WHERE i.id = ${itemId} AND p.distributor_id = ${actor.id}`);
  if (!r) throw new AppError("NOT_FOUND", "Item not found", 404);
  return r;
}
const DRAFT_ITEM = (itemId: string, actorId: string, version: number) =>
  sql`EXISTS (SELECT 1 FROM po_items i JOIN purchase_orders p ON p.id = i.po_id WHERE i.id = ${itemId} AND p.distributor_id = ${actorId} AND p.status = 'DRAFT' AND p.version = ${version})`;

/** Change an item's quantity while its PO is a DRAFT. Coverage may break temporarily; place re-checks it. */
export async function editItemQty(db: Db, actor: User, itemId: string, input: { version: number; qtyKg: number }, now = Date.now()): Promise<{ version: number }> {
  try {
    await guardedBatch(db, [
      assertSql(DRAFT_ITEM(itemId, actor.id, input.version)),
      sql`UPDATE po_items SET qty_kg = ${input.qtyKg} WHERE id = ${itemId}`,
      sql`UPDATE purchase_orders SET version = version + 1, updated_at = ${now} WHERE id = (SELECT po_id FROM po_items WHERE id = ${itemId})`,
    ]);
  } catch (e) {
    if (isAssertFailure(e)) await diagnoseItem(db, actor, itemId, input.version);
    throw e;
  }
  return { version: input.version + 1 };
}

async function diagnoseItem(db: Db, actor: User, itemId: string, version: number): Promise<never> {
  const it = await readItem(db, actor, itemId);
  if (it.status !== "DRAFT") throw NOT_DRAFT();
  if (it.version !== version) throw STALE();
  throw new AppError("CONFLICT", "Could not change the draft, please retry", 409);
}

/** Move `qtyKg` of an item into a new DRAFT PO (target provider or none). The original keeps the rest. */
export async function splitItem(
  db: Db,
  actor: User,
  itemId: string,
  input: { version: number; qtyKg: number; providerId: string | null },
  now = Date.now(),
): Promise<{ poId: string }> {
  const it = await readItem(db, actor, itemId);
  if (it.status !== "DRAFT") throw NOT_DRAFT();
  if (it.version !== input.version) throw STALE();
  if (input.qtyKg >= it.qty_kg) throw new AppError("INVALID_QTY", "Split quantity must be less than the item quantity", 422, undefined, { qtyTonnes: "Must be less than the item quantity" });
  const poId = uuidv7();
  const newItemId = uuidv7();
  const gate = input.providerId ? activeLink(input.providerId, actor.id, "PROVIDER_DISTRIBUTOR") : sql`1`;
  try {
    await guardedBatch(db, [
      assertSql(sql`${DRAFT_ITEM(itemId, actor.id, input.version)} AND (SELECT qty_kg FROM po_items WHERE id = ${itemId}) = ${it.qty_kg} AND ${gate}`),
      sql`UPDATE po_items SET qty_kg = qty_kg - ${input.qtyKg} WHERE id = ${itemId}`,
      sql`UPDATE purchase_orders SET version = version + 1, updated_at = ${now} WHERE id = ${it.po_id}`,
      db.insert(purchaseOrders).values({ id: poId, distributorId: actor.id, providerId: input.providerId, status: "DRAFT", version: 0, createdAt: now, updatedAt: now }),
      db.insert(poItems).values({ id: newItemId, poId, orderId: it.order_id, distributorId: actor.id, qtyKg: input.qtyKg, sourceItemId: itemId, createdAt: now }),
      assertSql(sql`(SELECT qty_kg FROM po_items WHERE id = ${itemId}) = ${it.qty_kg - input.qtyKg} AND (SELECT qty_kg FROM po_items WHERE id = ${newItemId}) = ${input.qtyKg}`),
    ]);
  } catch (e) {
    if (isAssertFailure(e)) {
      if (input.providerId) {
        const [p] = await db.all<{ ok: number }>(sql`SELECT (${gate}) AS ok`);
        if (!p?.ok) throw NOT_LINKED();
      }
      await diagnoseItem(db, actor, itemId, input.version);
    }
    throw e;
  }
  return { poId };
}
