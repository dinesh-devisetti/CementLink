import { sql, type SQL } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { Db } from "../db/client";
import { AppError } from "../errors";
import { activeUser } from "../db/fragments";
import { assertSql, guardedBatch, isAssertFailure } from "../db/guard";
import type { User } from "../db/schema";
import { istDate, todayIst } from "@/lib/dates";
import type { DispatchInput, RejectPoInput } from "@/lib/validation/po-lifecycle";

/** Provider side of the PO lifecycle (ADR-001 6.4): accept (C), reject (G, regenerates drafts), dispatch (G, order rollup). */

interface OwnPo {
  status: string;
  version: number;
  placed_at: number;
}
interface ItemRow {
  id: string;
  order_id: string;
  distributor_id: string;
  qty_kg: number;
}

const list = (ids: readonly string[]): SQL => sql`(${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`;
const label = (s: string) => s.toLowerCase().replace(/_/g, " ");

/** The provider's own non-DRAFT PO. A foreign, draft or missing PO is 404 (a provider never learns about drafts). */
async function readOwn(db: Db, actor: User, poId: string): Promise<OwnPo> {
  const [po] = await db.all<OwnPo>(sql`SELECT status, version, COALESCE(placed_at, created_at) AS placed_at FROM purchase_orders WHERE id = ${poId} AND provider_id = ${actor.id} AND status <> 'DRAFT'`);
  if (!po) throw new AppError("NOT_FOUND", "Purchase order not found", 404);
  return po;
}
async function requireStatus(db: Db, actor: User, poId: string, want: string, verb: string): Promise<OwnPo> {
  const po = await readOwn(db, actor, poId);
  if (po.status !== want) throw new AppError("INVALID_STATE", `This purchase order is ${label(po.status)}; only a ${label(want)} one can be ${verb}`, 409);
  return po;
}
const conflict = (what: string) => new AppError("CONFLICT", `Could not ${what} the purchase order, please retry`, 409);

/** PLACED -> ACCEPTED (C): one conditional UPDATE, so concurrent accepts have exactly one winner. */
export async function acceptPo(db: Db, actor: User, poId: string, now = Date.now()): Promise<void> {
  const res = await db.run(sql`UPDATE purchase_orders SET status = 'ACCEPTED', decided_at = ${now}, updated_at = ${now}, version = version + 1
    WHERE id = ${poId} AND provider_id = ${actor.id} AND status = 'PLACED' AND ${activeUser(actor.id)}`);
  if (res.rowsAffected > 0) return;
  await requireStatus(db, actor, poId, "PLACED", "accepted");
  throw conflict("accept");
}

/**
 * PLACED -> REJECTED (G). The frozen items (read first, immutable on a PLACED PO) are copied into new provider-less DRAFT POs,
 * one per source order with source_item_id set, and every touched POS_PLACED order reverts to UNDER_REVIEW in the same batch.
 * Post-asserts: one new draft item per old item, quantities preserved.
 */
export async function rejectPo(db: Db, actor: User, poId: string, input: RejectPoInput, now = Date.now()): Promise<{ drafts: number }> {
  const po = await requireStatus(db, actor, poId, "PLACED", "rejected");
  const items = await db.all<ItemRow>(sql`SELECT id, order_id, distributor_id, qty_kg FROM po_items WHERE po_id = ${poId} ORDER BY created_at, id`);
  if (items.length === 0) throw conflict("reject");
  const [dist] = await db.all<{ distributor_id: string }>(sql`SELECT distributor_id FROM purchase_orders WHERE id = ${poId}`);
  const orderIds = [...new Set(items.map((i) => i.order_id))];
  const itemIds = items.map((i) => i.id);
  const copies = items.map((i) => ({ ...i, poId: uuidv7(), itemId: uuidv7() }));
  const total = items.reduce((s, i) => s + i.qty_kg, 0);
  try {
    await guardedBatch(db, [
      assertSql(sql`${activeUser(actor.id)} AND EXISTS (SELECT 1 FROM purchase_orders WHERE id = ${poId} AND provider_id = ${actor.id} AND status = 'PLACED' AND version = ${po.version})
        AND (SELECT count(*) FROM po_items WHERE po_id = ${poId}) = ${items.length}
        AND (SELECT count(*) FROM orders WHERE id IN ${list(orderIds)} AND status IN ('UNDER_REVIEW','POS_PLACED')) = ${orderIds.length}`),
      sql`UPDATE purchase_orders SET status = 'REJECTED', reject_reason = ${input.reason}, decided_at = ${now}, updated_at = ${now}, version = version + 1 WHERE id = ${poId}`,
      ...copies.flatMap((c) => [
        sql`INSERT INTO purchase_orders (id, distributor_id, provider_id, status, version, created_at, updated_at) VALUES (${c.poId}, ${dist.distributor_id}, NULL, 'DRAFT', 0, ${now}, ${now})`,
        sql`INSERT INTO po_items (id, po_id, order_id, distributor_id, qty_kg, source_item_id, created_at) VALUES (${c.itemId}, ${c.poId}, ${c.order_id}, ${c.distributor_id}, ${c.qty_kg}, ${c.id}, ${now})`,
      ]),
      sql`UPDATE orders SET status = 'UNDER_REVIEW', updated_at = ${now} WHERE id IN ${list(orderIds)} AND status = 'POS_PLACED'`,
      assertSql(sql`(SELECT count(*) FROM po_items WHERE source_item_id IN ${list(itemIds)}) = ${items.length}
        AND (SELECT COALESCE(SUM(qty_kg), 0) FROM po_items WHERE source_item_id IN ${list(itemIds)}) = ${total}
        AND (SELECT count(*) FROM orders WHERE id IN ${list(orderIds)} AND status = 'UNDER_REVIEW') = ${orderIds.length}
        AND (SELECT status FROM purchase_orders WHERE id = ${poId}) = 'REJECTED'`),
    ]);
  } catch (e) {
    if (!isAssertFailure(e)) throw e;
    await requireStatus(db, actor, poId, "PLACED", "rejected");
    throw conflict("reject");
  }
  return { drafts: copies.length };
}

/**
 * ACCEPTED -> DISPATCHED (G): one dispatches row (UNIQUE po_id), the PO flips, and each POS_PLACED order rolls up to DISPATCHED
 * only when no live item remains in a DRAFT/PLACED/ACCEPTED PO. The date must be within [placed date, today] (IST).
 */
export async function dispatchPo(db: Db, actor: User, poId: string, input: DispatchInput, now = Date.now()): Promise<{ id: string }> {
  const po = await requireStatus(db, actor, poId, "ACCEPTED", "dispatched");
  const placedOn = istDate(po.placed_at);
  if (input.dispatchDate < placedOn) throw new AppError("INVALID_DATE", `Dispatch date cannot be before the PO placed date (${placedOn})`, 422, undefined, { dispatchDate: `Cannot be before ${placedOn}` });
  if (input.dispatchDate > todayIst(new Date(now))) throw new AppError("INVALID_DATE", "Dispatch date cannot be in the future", 422, undefined, { dispatchDate: "Cannot be in the future" });
  const [row] = await db.all<{ distributor_id: string }>(sql`SELECT distributor_id FROM purchase_orders WHERE id = ${poId}`);
  const orderIds = (await db.all<{ order_id: string }>(sql`SELECT DISTINCT order_id FROM po_items WHERE po_id = ${poId}`)).map((r) => r.order_id);
  const id = uuidv7();
  try {
    await guardedBatch(db, [
      assertSql(sql`${activeUser(actor.id)} AND EXISTS (SELECT 1 FROM purchase_orders WHERE id = ${poId} AND provider_id = ${actor.id} AND status = 'ACCEPTED' AND version = ${po.version})
        AND NOT EXISTS (SELECT 1 FROM dispatches WHERE po_id = ${poId})`),
      sql`INSERT INTO dispatches (id, po_id, provider_id, distributor_id, dispatch_date, vehicle_no, driver_phone, created_at)
        VALUES (${id}, ${poId}, ${actor.id}, ${row.distributor_id}, ${input.dispatchDate}, ${input.vehicleNo}, ${input.driverPhone}, ${now})`,
      sql`UPDATE purchase_orders SET status = 'DISPATCHED', updated_at = ${now}, version = version + 1 WHERE id = ${poId} AND status = 'ACCEPTED'`,
      ...(orderIds.length
        ? [sql`UPDATE orders SET status = 'DISPATCHED', updated_at = ${now}
            WHERE id IN ${list(orderIds)} AND status = 'POS_PLACED'
              AND NOT EXISTS (SELECT 1 FROM po_items i JOIN purchase_orders p ON p.id = i.po_id WHERE i.order_id = orders.id AND p.status IN ('DRAFT','PLACED','ACCEPTED'))`]
        : []),
      assertSql(sql`(SELECT status FROM purchase_orders WHERE id = ${poId}) = 'DISPATCHED' AND EXISTS (SELECT 1 FROM dispatches WHERE id = ${id})`),
    ]);
  } catch (e) {
    if (!isAssertFailure(e)) throw e;
    await requireStatus(db, actor, poId, "ACCEPTED", "dispatched");
    throw conflict("dispatch");
  }
  return { id };
}
