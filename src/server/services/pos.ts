import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { AppError } from "../errors";
import type { PoStatus, User } from "../db/schema";
import { partyLabel } from "./party-label";

/**
 * One PO as seen by the caller. Fields a role may not see are null:
 *  - DISTRIBUTOR: everything of its own POs including DRAFT, plus order coverage per item.
 *  - PROVIDER: own non-DRAFT POs with each item's delivery address and the customer display name (no email/phone).
 *  - CUSTOMER: non-DRAFT POs holding its own items only; qtyKg is the customer's own part, no rate, no version.
 */
export interface PoItemView {
  id: string | null;
  orderId: string;
  qtyKg: number;
  customerName: string | null;
  orderQtyKg: number | null;
  orderCoverageKg: number | null;
  address: string | null;
  city: string | null;
  pincode: string | null;
  neededBy: string | null;
}
export interface PoView {
  id: string;
  status: PoStatus;
  version: number | null;
  providerId: string | null;
  providerName: string | null;
  distributorName: string | null;
  ratePerTonnePaise: number | null;
  totalPaise: number | null;
  qtyKg: number;
  createdAt: number;
  placedAt: number | null;
  /** Provider's reason, visible to the distributor and the provider only. */
  rejectReason: string | null;
  /** Transport details once dispatched. A customer gets the date and vehicle but never the driver's phone. */
  dispatch: { dispatchDate: string; vehicleNo: string | null; driverPhone: string | null } | null;
  items: PoItemView[];
}

interface RawPo {
  id: string;
  status: PoStatus;
  version: number;
  provider_id: string | null;
  p_business: string | null;
  d_business: string | null;
  distributor_id: string;
  rate: number | null;
  total: number | null;
  qty: number | null;
  items_kg: number;
  created_at: number;
  placed_at: number | null;
  reject_reason: string | null;
  dp_date: string | null;
  dp_vehicle: string | null;
  dp_phone: string | null;
}
interface RawItem {
  id: string;
  po_id: string;
  order_id: string;
  qty_kg: number;
  c_id: string;
  c_name: string;
  c_business: string | null;
  o_qty: number;
  coverage: number;
  address: string;
  city: string;
  pincode: string;
  needed_by: string;
}

const scope = (a: User): SQL =>
  a.role === "DISTRIBUTOR"
    ? sql`p.distributor_id = ${a.id}`
    : a.role === "PROVIDER"
      ? sql`p.provider_id = ${a.id} AND p.status <> 'DRAFT'`
      : sql`p.status NOT IN ('DRAFT','REJECTED') AND EXISTS (SELECT 1 FROM po_items i JOIN orders o ON o.id = i.order_id WHERE i.po_id = p.id AND o.customer_id = ${a.id})`;

const SELECT = sql`SELECT p.id, p.status, p.version, p.provider_id, pr.business_name AS p_business, d.business_name AS d_business, p.distributor_id,
    p.rate_per_tonne_paise AS rate, p.total_paise AS total, p.qty_kg AS qty,
    (SELECT COALESCE(SUM(qty_kg), 0) FROM po_items WHERE po_id = p.id) AS items_kg, p.created_at, p.placed_at,
    p.reject_reason, dp.dispatch_date AS dp_date, dp.vehicle_no AS dp_vehicle, dp.driver_phone AS dp_phone
  FROM purchase_orders p LEFT JOIN users pr ON pr.id = p.provider_id JOIN users d ON d.id = p.distributor_id LEFT JOIN dispatches dp ON dp.po_id = p.id`;

async function itemsFor(db: Db, actor: User, poIds: readonly string[]): Promise<Map<string, RawItem[]>> {
  const map = new Map<string, RawItem[]>();
  if (poIds.length === 0) return map;
  const own = actor.role === "CUSTOMER" ? sql`AND o.customer_id = ${actor.id}` : sql``;
  const rows = await db.all<RawItem>(sql`SELECT i.id, i.po_id, i.order_id, i.qty_kg, o.customer_id AS c_id, c.name AS c_name, c.business_name AS c_business,
      o.qty_kg AS o_qty, (SELECT COALESCE(SUM(x.qty_kg), 0) FROM po_items x JOIN purchase_orders q ON q.id = x.po_id WHERE x.order_id = o.id AND q.status <> 'REJECTED') AS coverage,
      o.address, o.city, o.pincode, o.needed_by
    FROM po_items i JOIN orders o ON o.id = i.order_id JOIN users c ON c.id = o.customer_id
    WHERE i.po_id IN (${sql.join(poIds.map((i) => sql`${i}`), sql`, `)}) ${own} ORDER BY i.created_at, i.id`);
  return rows.reduce((m, r) => new Map(m).set(r.po_id, [...(m.get(r.po_id) ?? []), r]), map);
}

function toItem(r: RawItem, actor: User): PoItemView {
  const customer = actor.role === "CUSTOMER" ? null : partyLabel(r.c_business, "CUSTOMER", r.c_id, actor.role === "DISTRIBUTOR" ? r.c_name : null);
  const provider = actor.role === "PROVIDER";
  const distributor = actor.role === "DISTRIBUTOR";
  return {
    id: distributor ? r.id : null,
    orderId: r.order_id,
    qtyKg: r.qty_kg,
    customerName: customer,
    orderQtyKg: distributor ? r.o_qty : null,
    orderCoverageKg: distributor ? r.coverage : null,
    address: provider ? r.address : null,
    city: provider ? r.city : null,
    pincode: provider ? r.pincode : null,
    neededBy: provider ? r.needed_by : null,
  };
}

function toView(r: RawPo, items: RawItem[], actor: User): PoView {
  const customer = actor.role === "CUSTOMER";
  return {
    id: r.id,
    status: r.status,
    version: customer ? null : r.version,
    providerId: customer ? null : r.provider_id,
    providerName: r.provider_id ? partyLabel(r.p_business, "PROVIDER", r.provider_id) : null,
    distributorName: customer ? null : partyLabel(r.d_business, "DISTRIBUTOR", r.distributor_id),
    ratePerTonnePaise: customer ? null : r.rate,
    totalPaise: customer ? null : r.total,
    qtyKg: customer ? items.reduce((s, i) => s + i.qty_kg, 0) : (r.qty ?? Number(r.items_kg)),
    createdAt: r.created_at,
    placedAt: r.placed_at,
    rejectReason: customer ? null : r.reject_reason,
    dispatch: r.dp_date ? { dispatchDate: r.dp_date, vehicleNo: r.dp_vehicle, driverPhone: customer ? null : r.dp_phone } : null,
    items: items.map((i) => toItem(i, actor)),
  };
}

/** Own POs, newest first. `orderId` limits a distributor's list to POs holding an item of that order. */
export async function listPos(
  db: Db,
  actor: User,
  opts: { status?: PoStatus; excludeDraft?: boolean; orderId?: string; distributorId?: string; page: number; limit: number },
): Promise<{ rows: PoView[]; total: number }> {
  const filters = sql.join(
    [scope(actor), ...(opts.status ? [sql`p.status = ${opts.status}`] : []), ...(opts.excludeDraft ? [sql`p.status <> 'DRAFT'`] : []), ...(opts.distributorId ? [sql`p.distributor_id = ${opts.distributorId}`] : []), ...(opts.orderId ? [sql`EXISTS (SELECT 1 FROM po_items i WHERE i.po_id = p.id AND i.order_id = ${opts.orderId})`] : [])],
    sql` AND `,
  );
  const raws = await db.all<RawPo>(sql`${SELECT} WHERE ${filters} ORDER BY p.created_at DESC, p.id DESC LIMIT ${opts.limit} OFFSET ${(opts.page - 1) * opts.limit}`);
  const [t] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM purchase_orders p WHERE ${filters}`);
  const items = await itemsFor(db, actor, raws.map((r) => r.id));
  return { rows: raws.map((r) => toView(r, items.get(r.id) ?? [], actor)), total: Number(t?.n ?? 0) };
}

/** One PO in the caller's scope; anything else is 404 (a provider asking for a DRAFT included). */
export async function getPo(db: Db, actor: User, poId: string): Promise<PoView> {
  const [r] = await db.all<RawPo>(sql`${SELECT} WHERE p.id = ${poId} AND ${scope(actor)}`);
  if (!r) throw new AppError("NOT_FOUND", "Purchase order not found", 404);
  const items = await itemsFor(db, actor, [r.id]);
  return toView(r, items.get(r.id) ?? [], actor);
}

/** Providers ACTIVE-linked to this distributor: the choices for a draft's provider. */
export async function listLinkedProviders(db: Db, distributorId: string): Promise<Array<{ id: string; name: string }>> {
  const rows = await db.all<{ id: string; business_name: string | null }>(sql`SELECT u.id, u.business_name FROM links l
    JOIN users u ON u.id = l.upper_id AND u.status = 'ACTIVE'
    WHERE l.lower_id = ${distributorId} AND l.kind = 'PROVIDER_DISTRIBUTOR' AND l.status = 'ACTIVE' ORDER BY u.business_name, u.id`);
  return rows.map((r) => ({ id: r.id, name: partyLabel(r.business_name, "PROVIDER", r.id) }));
}
