import { sql, type SQL } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { Db } from "../db/client";
import { AppError } from "../errors";
import { activeUser } from "../db/fragments";
import { assertSql, guardedBatch, isAssertFailure } from "../db/guard";
import { purchaseOrders } from "../db/schema";
import type { User } from "../db/schema";
import { planCombine, type CombinePo } from "../domain/combine-plan";
import { SPLIT_BACK_MESSAGES, planSplitBack } from "../domain/split-plan";
import type { CombineInput, SplitBackInput } from "@/lib/validation/drafts";

const STALE = () => new AppError("STALE", "This draft changed. Refresh and try again", 409);
const NOT_COMBINABLE = (why: string) => new AppError("NOT_COMBINABLE", why, 422);
const list = (ids: readonly string[]): SQL => sql`(${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`;
const coverage = (orderId: string | SQL): SQL =>
  sql`(SELECT COALESCE(SUM(cv_i.qty_kg), 0) FROM po_items cv_i JOIN purchase_orders cv_p ON cv_p.id = cv_i.po_id WHERE cv_i.order_id = ${orderId} AND cv_p.status <> 'REJECTED')`;

interface PoRow { id: string; status: string; version: number; provider_id: string | null; created_at: number; rate: number | null }
interface ItemRow { id: string; po_id: string; order_id: string; qty_kg: number; created_at: number }

async function readPos(db: Db, actor: User, ids: readonly string[]): Promise<PoRow[]> {
  return db.all<PoRow>(sql`SELECT id, status, version, provider_id, created_at, rate_per_tonne_paise AS rate FROM purchase_orders
    WHERE distributor_id = ${actor.id} AND id IN ${list(ids)}`);
}
const readItems = (db: Db, ids: readonly string[]) =>
  db.all<ItemRow>(sql`SELECT id, po_id, order_id, qty_kg, created_at FROM po_items WHERE po_id IN ${list(ids)} ORDER BY created_at, id`);

/** Reads and validates the selection; the one place that decides NOT_COMBINABLE vs STALE. */
async function precheck(db: Db, actor: User, input: CombineInput) {
  const ids = input.pos.map((p) => p.id);
  const rows = await readPos(db, actor, ids);
  // A foreign or missing id looks the same as an uncombinable one: no existence leak.
  if (rows.length !== ids.length) throw NOT_COMBINABLE("Some selected drafts are not available to combine");
  if (rows.some((r) => r.status !== "DRAFT")) throw NOT_COMBINABLE("Only drafts can be combined");
  const providers = new Set(rows.map((r) => r.provider_id));
  const provider = rows[0].provider_id;
  if (providers.size !== 1 || !provider) throw NOT_COMBINABLE("Select drafts of the same provider");
  const rates = new Set(rows.map((r) => r.rate).filter((r): r is number => r !== null));
  if (rates.size > 1) throw NOT_COMBINABLE("Drafts have different rates");
  const versions = new Map(rows.map((r) => [r.id, r.version]));
  if (input.pos.some((p) => versions.get(p.id) !== p.version)) throw STALE();
  return { ids, rows, provider, rate: [...rates][0] ?? null, items: await readItems(db, ids) };
}

/**
 * Combine 2..20 DRAFT POs of the same non-null provider into the oldest one (G). One item per source order remains
 * (same-order items are merged). Pre-asserts every PO is still DRAFT at its version with the same provider and item count;
 * post-asserts each touched order's coverage is unchanged, the emptied POs are gone and the target holds one item per order.
 */
export async function combinePos(db: Db, actor: User, input: CombineInput, now = Date.now()): Promise<{ poId: string; version: number }> {
  const { ids, rows, provider, rate, items } = await precheck(db, actor, input);
  const pos: CombinePo[] = rows.map((r) => ({
    id: r.id,
    createdAt: r.created_at,
    items: items.filter((i) => i.po_id === r.id).map((i) => ({ id: i.id, orderId: i.order_id, qtyKg: i.qty_kg, createdAt: i.created_at })),
  }));
  if (pos.some((p) => p.items.length === 0)) throw NOT_COMBINABLE("A selected draft has no items");
  const plan = planCombine(pos);
  const targetVersion = rows.find((r) => r.id === plan.targetId)!.version;
  const orderIds = plan.steps.map((st) => st.orderId);
  const before = await db.all<{ order_id: string; cov: number }>(
    sql`SELECT o.id AS order_id, ${coverage(sql`o.id`)} AS cov FROM orders o WHERE o.id IN ${list(orderIds)}`,
  );
  const pre = input.pos.map(
    (p) => sql`EXISTS (SELECT 1 FROM purchase_orders WHERE id = ${p.id} AND distributor_id = ${actor.id} AND status = 'DRAFT' AND version = ${p.version} AND provider_id = ${provider})`,
  );
  const deleteIds = plan.steps.flatMap((s) => s.deleteItemIds);
  try {
    await guardedBatch(db, [
      assertSql(sql.join([activeUser(actor.id), sql`(SELECT count(*) FROM po_items WHERE po_id IN ${list(ids)}) = ${items.length}`, ...pre], sql` AND `)),
      ...(deleteIds.length ? [sql`DELETE FROM po_items WHERE id IN ${list(deleteIds)}`] : []),
      ...plan.steps.map((s) =>
        s.moveToTarget
          ? sql`UPDATE po_items SET qty_kg = ${s.qtyKg}, po_id = ${plan.targetId} WHERE id = ${s.keepItemId}`
          : sql`UPDATE po_items SET qty_kg = ${s.qtyKg} WHERE id = ${s.keepItemId}`,
      ),
      sql`DELETE FROM purchase_orders WHERE id IN ${list(plan.emptiedPoIds)} AND status = 'DRAFT' AND NOT EXISTS (SELECT 1 FROM po_items WHERE po_id = purchase_orders.id)`,
      sql`UPDATE purchase_orders SET version = version + 1, updated_at = ${now}, rate_per_tonne_paise = ${rate} WHERE id = ${plan.targetId}`,
      assertSql(
        sql.join(
          [
            sql`(SELECT rate_per_tonne_paise FROM purchase_orders WHERE id = ${plan.targetId}) IS ${rate}`,
            sql`(SELECT count(*) FROM purchase_orders WHERE id IN ${list(plan.emptiedPoIds)}) = 0`,
            sql`(SELECT count(*) FROM po_items WHERE po_id = ${plan.targetId}) = ${plan.steps.length}`,
            ...before.map((b) => sql`${coverage(b.order_id)} = ${b.cov}`),
          ],
          sql` AND `,
        ),
      ),
    ]);
  } catch (e) {
    if (!isAssertFailure(e)) throw e;
    await precheck(db, actor, input);
    throw new AppError("CONFLICT", "Could not combine the drafts, please retry", 409);
  }
  return { poId: plan.targetId, version: targetVersion + 1 };
}

/** Move the chosen items of a DRAFT PO into a new DRAFT PO with the same provider and rate (G). At least one item stays. */
export async function splitBack(db: Db, actor: User, poId: string, input: SplitBackInput, now = Date.now()): Promise<{ poId: string; version: number; sourcePoId: string; sourceVersion: number }> {
  const read = async () => {
    const [po] = await readPos(db, actor, [poId]);
    if (!po) throw new AppError("NOT_FOUND", "Draft not found", 404);
    if (po.status !== "DRAFT") throw new AppError("INVALID_STATE", "Only a draft can be changed", 409);
    if (po.version !== input.version) throw STALE();
    return { po, items: await readItems(db, [poId]) };
  };
  const { po, items } = await read();
  const plan = planSplitBack(items.map((i) => i.id), input.itemIds);
  if (!plan.ok) throw new AppError("INVALID_SPLIT", SPLIT_BACK_MESSAGES[plan.error], 422, undefined, { itemIds: SPLIT_BACK_MESSAGES[plan.error] });
  const newId = uuidv7();
  try {
    await guardedBatch(db, [
      assertSql(sql`${activeUser(actor.id)} AND EXISTS (SELECT 1 FROM purchase_orders WHERE id = ${poId} AND distributor_id = ${actor.id} AND status = 'DRAFT' AND version = ${input.version})
        AND (SELECT count(*) FROM po_items WHERE po_id = ${poId}) = ${items.length}`),
      db.insert(purchaseOrders).values({ id: newId, distributorId: actor.id, providerId: po.provider_id, status: "DRAFT", version: 0, ratePerTonnePaise: po.rate, createdAt: now, updatedAt: now }),
      sql`UPDATE po_items SET po_id = ${newId} WHERE po_id = ${poId} AND id IN ${list(plan.move)}`,
      sql`UPDATE purchase_orders SET version = version + 1, updated_at = ${now} WHERE id = ${poId}`,
      assertSql(sql`(SELECT count(*) FROM po_items WHERE po_id = ${newId}) = ${plan.move.length} AND (SELECT count(*) FROM po_items WHERE po_id = ${poId}) = ${plan.stay.length}`),
    ]);
  } catch (e) {
    if (!isAssertFailure(e)) throw e;
    await read();
    throw new AppError("CONFLICT", "Could not split the draft, please retry", 409);
  }
  return { poId: newId, version: 0, sourcePoId: poId, sourceVersion: input.version + 1 };
}
