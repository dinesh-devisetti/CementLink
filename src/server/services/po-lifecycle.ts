import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { AppError } from "../errors";
import { activeLink, activeUser } from "../db/fragments";
import { assertSql, guardedBatch, isAssertFailure } from "../db/guard";
import type { User } from "../db/schema";
import { formatTonnes } from "@/lib/qty";
import type { PlaceInput } from "@/lib/validation/drafts";

interface PoRow {
  id: string;
  status: string;
  version: number;
  provider_id: string | null;
  items: number;
}
interface OrderRow {
  id: string;
  status: string;
  qty_kg: number;
  coverage_kg: number;
}

const list = (ids: readonly string[]): SQL => sql`(${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`;
const COVERAGE = sql`(SELECT COALESCE(SUM(i.qty_kg), 0) FROM po_items i JOIN purchase_orders p ON p.id = i.po_id WHERE i.order_id = o.id AND p.status <> 'REJECTED')`;

/** Reads the selected POs and the orders they touch, and throws the precise AppError for the first problem found. */
async function precheck(db: Db, actor: User, input: PlaceInput): Promise<{ orderIds: string[]; itemCount: number }> {
  const ids = input.pos.map((p) => p.id);
  const rows = await db.all<PoRow>(sql`SELECT p.id, p.status, p.version, p.provider_id, (SELECT count(*) FROM po_items WHERE po_id = p.id) AS items
    FROM purchase_orders p WHERE p.distributor_id = ${actor.id} AND p.id IN ${list(ids)}`);
  const byId = new Map(rows.map((r) => [r.id, r]));
  for (const sel of input.pos) {
    const r = byId.get(sel.id);
    if (!r) throw new AppError("NOT_FOUND", "Draft not found", 404);
    if (r.status !== "DRAFT") throw new AppError("INVALID_STATE", "Only drafts can be placed", 409);
    if (r.version !== sel.version) throw new AppError("STALE", "This draft changed. Refresh and try again", 409);
    if (!r.provider_id) throw new AppError("NO_PROVIDER", "Choose a provider for every draft before placing", 422);
    if (Number(r.items) === 0) throw new AppError("EMPTY_DRAFT", "A draft has no items", 422);
  }
  const providerIds = [...new Set(rows.map((r) => r.provider_id as string))];
  const [linked] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM users pu WHERE pu.id IN ${list(providerIds)} AND ${activeLink(sql`pu.id`, actor.id, "PROVIDER_DISTRIBUTOR")}`);
  if (Number(linked?.n) !== providerIds.length) throw new AppError("PROVIDER_NOT_LINKED", "A chosen provider is no longer linked to you", 422);
  const touched = await db.all<OrderRow>(sql`SELECT o.id, o.status, o.qty_kg, ${COVERAGE} AS coverage_kg FROM orders o
    WHERE o.id IN (SELECT order_id FROM po_items WHERE po_id IN ${list(ids)}) ORDER BY o.created_at, o.id`);
  for (const o of touched) {
    if (o.status !== "UNDER_REVIEW") throw new AppError("INVALID_STATE", `Order #${o.id.slice(-4)} is ${o.status.toLowerCase().replace(/_/g, " ")}`, 409);
    if (o.coverage_kg !== o.qty_kg) {
      throw new AppError("QTY_MISMATCH", `Order #${o.id.slice(-4)} needs ${formatTonnes(o.qty_kg)}, drafts total ${formatTonnes(o.coverage_kg)}`, 422);
    }
  }
  return { orderIds: touched.map((o) => o.id), itemCount: rows.reduce((s, r) => s + Number(r.items), 0) };
}

/**
 * Place selected drafts (G). Pre-asserts: all own, DRAFT, versions match, provider set and ACTIVE-linked, distributor
 * ACTIVE, items unchanged, and every touched order UNDER_REVIEW with coverage = qty. Writes freeze qty_kg (= SUM items)
 * and the total, then roll touched orders up to POS_PLACED when no draft item remains.
 */
export async function placePos(db: Db, actor: User, input: PlaceInput, now = Date.now()): Promise<{ placed: number }> {
  const { orderIds, itemCount } = await precheck(db, actor, input);
  const ids = input.pos.map((p) => p.id);
  const perPo = input.pos.map(
    (p) => sql`EXISTS (SELECT 1 FROM purchase_orders p WHERE p.id = ${p.id} AND p.distributor_id = ${actor.id} AND p.status = 'DRAFT' AND p.version = ${p.version}
      AND p.provider_id IS NOT NULL AND ${activeLink(sql`p.provider_id`, actor.id, "PROVIDER_DISTRIBUTOR")})`,
  );
  const perOrder = orderIds.map(
    (id) => sql`EXISTS (SELECT 1 FROM orders o WHERE o.id = ${id} AND o.status = 'UNDER_REVIEW' AND o.qty_kg = ${COVERAGE})`,
  );
  const sumItems = sql`(SELECT SUM(qty_kg) FROM po_items WHERE po_id = purchase_orders.id)`;
  try {
    await guardedBatch(db, [
      assertSql(sql.join([activeUser(actor.id), sql`(SELECT count(*) FROM po_items WHERE po_id IN ${list(ids)}) = ${itemCount}`, ...perPo, ...perOrder], sql` AND `)),
      sql`UPDATE purchase_orders SET status = 'PLACED', placed_at = ${now}, updated_at = ${now}, version = version + 1,
        qty_kg = ${sumItems},
        total_paise = CASE WHEN rate_per_tonne_paise IS NULL THEN NULL ELSE (${sumItems} * rate_per_tonne_paise + 500) / 1000 END
        WHERE id IN ${list(ids)} AND status = 'DRAFT'`,
      sql`UPDATE orders SET status = 'POS_PLACED', updated_at = ${now}
        WHERE id IN ${list(orderIds)} AND status = 'UNDER_REVIEW'
          AND NOT EXISTS (SELECT 1 FROM po_items i JOIN purchase_orders p ON p.id = i.po_id WHERE i.order_id = orders.id AND p.status = 'DRAFT')`,
      assertSql(sql`(SELECT count(*) FROM purchase_orders WHERE id IN ${list(ids)} AND status = 'PLACED' AND qty_kg = ${sumItems}) = ${ids.length}`),
    ]);
  } catch (e) {
    if (isAssertFailure(e)) {
      await precheck(db, actor, input);
      throw new AppError("CONFLICT", "Could not place the purchase orders, please retry", 409);
    }
    throw e;
  }
  return { placed: ids.length };
}
