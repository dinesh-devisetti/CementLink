import { and, count, desc, eq, inArray, sql } from "drizzle-orm";
import { v4 as uuid } from "uuid";
import type { Db } from "../db/client";
import { invoices, purchaseOrders, users, type PoStatus } from "../db/schema";
import { formatPaise } from "../../lib/money";
import { AppError } from "../errors";

export interface InvoiceView {
  id: string;
  poId: string;
  /** Distributor's name (provider view) or provider's name (distributor view). */
  counterparty: string;
  invoiceNo: string;
  invoiceDate: string;
  qtyBags: number;
  ratePerBagPaise: number;
  amountPaise: number;
  createdAt: number;
}

export interface Actor {
  id: string;
  role: "DISTRIBUTOR" | "PROVIDER";
}

export const PO_INVOICE_PREVIEW = 50;

export interface InvoiceGroup {
  rows: InvoiceView[];
  total: number;
}

export interface PoForInvoice {
  id: string;
  distributorName: string;
  qtyBags: number;
  ratePerBagPaise: number;
  status: PoStatus;
  invoicedBags: number;
  remainingBags: number;
  /** Newest PO_INVOICE_PREVIEW invoices; invoiceCount is the full count. */
  invoices: InvoiceView[];
  invoiceCount: number;
}

export function isUniqueViolation(e: unknown): boolean {
  for (let cur: unknown = e, i = 0; cur && i < 4; i += 1) {
    const msg = String((cur as { message?: unknown }).message ?? "");
    if (msg.includes("UNIQUE constraint failed") && msg.includes("invoices.provider_id, invoices.invoice_no")) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

const viewCols = {
  id: invoices.id,
  poId: invoices.poId,
  invoiceNo: invoices.invoiceNo,
  invoiceDate: invoices.invoiceDate,
  qtyBags: invoices.qtyBags,
  ratePerBagPaise: invoices.ratePerBagPaise,
  amountPaise: invoices.amountPaise,
  createdAt: invoices.createdAt,
  businessName: users.businessName,
  name: users.name,
};
type ViewRow = { businessName: string | null; name: string } & Omit<InvoiceView, "counterparty">;
const toView = ({ businessName, name, ...r }: ViewRow): InvoiceView => ({ ...r, counterparty: businessName ?? name });

/**
 * Single conditional INSERT...SELECT (atomic in SQLite/libSQL): only when the PO is the provider's own, CONFIRMED,
 * the provider is ACTIVE, the date is not before the PO date (IST), and invoiced bags and amount (plus this one) stay
 * within the PO qty and PO total. Amount is computed in SQL. Rate stays editable, so discounts are fine.
 */
export async function createInvoice(
  db: Db,
  providerId: string,
  poId: string,
  input: { invoiceNo: string; invoiceDate: string; qtyBags: number; ratePerBagPaise: number },
  now: number = Date.now(),
): Promise<{ id: string; amountPaise: number }> {
  const { invoiceNo, invoiceDate, qtyBags, ratePerBagPaise } = input;
  const id = uuid();
  let rowsAffected = 0;
  try {
    const res = await db.run(sql`
      insert into invoices (id, po_id, provider_id, distributor_id, invoice_no, invoice_date, qty_bags, rate_per_bag_paise, amount_paise, created_at)
      select ${id}, po.id, po.provider_id, po.distributor_id, ${invoiceNo}, ${invoiceDate}, ${qtyBags}, ${ratePerBagPaise}, ${qtyBags} * ${ratePerBagPaise}, ${now}
      from purchase_orders po
      where po.id = ${poId} and po.provider_id = ${providerId} and po.status = 'CONFIRMED'
        and exists (select 1 from users u where u.id = ${providerId} and u.role = 'PROVIDER' and u.status = 'ACTIVE')
        and ${invoiceDate} >= date(po.created_at / 1000 + 19800, 'unixepoch')
        and ${qtyBags} + (select coalesce(sum(i.qty_bags), 0) from invoices i where i.po_id = po.id) <= po.qty_bags
        and ${qtyBags * ratePerBagPaise} + (select coalesce(sum(i.amount_paise), 0) from invoices i where i.po_id = po.id) <= po.total_paise`);
    rowsAffected = res.rowsAffected;
  } catch (e) {
    if (isUniqueViolation(e)) {
      throw new AppError("DUPLICATE_INVOICE_NO", "Invoice number already used", 409, undefined, {
        invoiceNo: "Invoice number already used",
      });
    }
    throw e;
  }
  if (rowsAffected === 1) return { id, amountPaise: qtyBags * ratePerBagPaise };

  const po = await getOwnPo(db, providerId, poId);
  if (!po) throw new AppError("NOT_FOUND", "Order not found", 404);
  const [p] = await db
    .select({ s: users.status })
    .from(users)
    .where(and(eq(users.id, providerId), eq(users.role, "PROVIDER")))
    .limit(1);
  if (p?.s !== "ACTIVE") throw new AppError("FORBIDDEN", "Your account is not active", 403);
  if (po.status !== "CONFIRMED") {
    throw new AppError("INVALID_STATE", "Invoices can only be added to confirmed orders", 409);
  }
  const poDate = new Date(po.createdAt + 330 * 60_000).toISOString().slice(0, 10);
  if (invoiceDate < poDate) {
    const m = `Date cannot be before the order date (${poDate})`;
    throw new AppError("DATE_BEFORE_PO", m, 422, undefined, { invoiceDate: m });
  }
  const left = Math.max(0, po.qtyBags - po.invoicedBags);
  if (qtyBags > left) {
    const msg = left === 0 ? "This order is already fully invoiced" : `Only ${left} bags left to invoice`;
    throw new AppError("QTY_EXCEEDS_PO", msg, 422, undefined, { qtyBags: msg });
  }
  const m = `Amount would exceed the order total (${formatPaise(Math.max(0, po.totalPaise - po.invoicedPaise))} left)`;
  throw new AppError("RATE_EXCEEDS_PO", m, 422, undefined, { ratePerBag: m });
}

async function getOwnPo(db: Db, providerId: string, poId: string) {
  const [po] = await db
    .select({
      id: purchaseOrders.id,
      qtyBags: purchaseOrders.qtyBags,
      ratePerBagPaise: purchaseOrders.ratePerBagPaise,
      totalPaise: purchaseOrders.totalPaise,
      createdAt: purchaseOrders.createdAt,
      status: purchaseOrders.status,
      businessName: users.businessName,
      name: users.name,
      invoicedBags: sql<number>`(select coalesce(sum(${invoices.qtyBags}), 0) from ${invoices} where ${invoices.poId} = ${purchaseOrders.id})`,
      invoicedPaise: sql<number>`(select coalesce(sum(${invoices.amountPaise}), 0) from ${invoices} where ${invoices.poId} = ${purchaseOrders.id})`,
    })
    .from(purchaseOrders)
    .innerJoin(users, eq(users.id, purchaseOrders.distributorId))
    .where(and(eq(purchaseOrders.id, poId), eq(purchaseOrders.providerId, providerId)))
    .limit(1);
  return po ? { ...po, invoicedBags: Number(po.invoicedBags), invoicedPaise: Number(po.invoicedPaise) } : null;
}

/** PO detail for the invoice form; null (-> 404) unless it is the provider's own. */
export async function getPoForInvoice(db: Db, providerId: string, poId: string): Promise<PoForInvoice | null> {
  const po = await getOwnPo(db, providerId, poId);
  if (!po) return null;
  const rows = await db
    .select(viewCols)
    .from(invoices)
    .innerJoin(users, eq(users.id, invoices.distributorId))
    .where(and(eq(invoices.poId, poId), eq(invoices.providerId, providerId)))
    .orderBy(desc(invoices.createdAt), desc(invoices.id))
    .limit(PO_INVOICE_PREVIEW);
  const [{ n }] = await db
    .select({ n: count() })
    .from(invoices)
    .where(and(eq(invoices.poId, poId), eq(invoices.providerId, providerId)));
  return {
    id: po.id,
    distributorName: po.businessName ?? po.name,
    qtyBags: po.qtyBags,
    ratePerBagPaise: po.ratePerBagPaise,
    status: po.status,
    invoicedBags: po.invoicedBags,
    remainingBags: Math.max(0, po.qtyBags - po.invoicedBags),
    invoices: rows.map(toView),
    invoiceCount: n,
  };
}

const ownerCol = (role: Actor["role"]) => (role === "PROVIDER" ? invoices.providerId : invoices.distributorId);

/** Own invoices only: provider sees what it issued, distributor what it received (read-only). */
export async function listInvoices(
  db: Db,
  actor: Actor,
  { page, limit }: { page: number; limit: number },
): Promise<{ rows: InvoiceView[]; total: number }> {
  const own = eq(ownerCol(actor.role), actor.id);
  const other = actor.role === "PROVIDER" ? invoices.distributorId : invoices.providerId;
  const rows = await db
    .select(viewCols)
    .from(invoices)
    .innerJoin(users, eq(users.id, other))
    .where(own)
    .orderBy(desc(invoices.createdAt), desc(invoices.id))
    .limit(limit)
    .offset((page - 1) * limit);
  const [{ total }] = await db.select({ total: count() }).from(invoices).where(own);
  return { rows: rows.map(toView), total };
}

/** Own invoices for a set of POs, newest PO_INVOICE_PREVIEW per PO plus the full count (distributor read-only view). */
export async function invoicesByPo(db: Db, actor: Actor, poIds: string[]): Promise<Record<string, InvoiceGroup>> {
  if (poIds.length === 0) return {};
  const other = actor.role === "PROVIDER" ? invoices.distributorId : invoices.providerId;
  const own = and(eq(ownerCol(actor.role), actor.id), inArray(invoices.poId, poIds));
  const newerCount = sql`(select count(*) from invoices x where x.po_id = ${invoices.poId}
    and (x.created_at > ${invoices.createdAt} or (x.created_at = ${invoices.createdAt} and x.id > ${invoices.id})))`;
  const [rows, totals] = await Promise.all([
    db
      .select(viewCols)
      .from(invoices)
      .innerJoin(users, eq(users.id, other))
      .where(and(own, sql`${newerCount} < ${PO_INVOICE_PREVIEW}`))
      .orderBy(desc(invoices.createdAt), desc(invoices.id)),
    db.select({ poId: invoices.poId, n: count() }).from(invoices).where(own).groupBy(invoices.poId),
  ]);
  const totalByPo = new Map(totals.map((t) => [t.poId, t.n]));
  return Object.fromEntries(
    [...totalByPo].map(([poId, total]) => [poId, { rows: rows.filter((r) => r.poId === poId).map(toView), total }]),
  );
}

export interface ProviderTotals {
  invoiceCount: number;
  bagsSold: number;
  invoicedPaise: number;
}

export interface DistributorTotal {
  distributorId: string;
  name: string;
  invoiceCount: number;
  bagsSold: number;
  invoicedPaise: number;
}

export async function providerInvoiceTotals(db: Db, providerId: string): Promise<ProviderTotals> {
  const [r] = await db
    .select({
      invoiceCount: count(),
      bagsSold: sql<number>`coalesce(sum(${invoices.qtyBags}), 0)`,
      invoicedPaise: sql<number>`coalesce(sum(${invoices.amountPaise}), 0)`,
    })
    .from(invoices)
    .where(eq(invoices.providerId, providerId));
  return { invoiceCount: r.invoiceCount, bagsSold: Number(r.bagsSold), invoicedPaise: Number(r.invoicedPaise) };
}

export async function providerTotalsByDistributor(db: Db, providerId: string): Promise<DistributorTotal[]> {
  const rows = await db
    .select({
      distributorId: invoices.distributorId,
      businessName: users.businessName,
      name: users.name,
      invoiceCount: count(),
      bagsSold: sql<number>`sum(${invoices.qtyBags})`,
      invoicedPaise: sql<number>`sum(${invoices.amountPaise})`,
    })
    .from(invoices)
    .innerJoin(users, eq(users.id, invoices.distributorId))
    .where(eq(invoices.providerId, providerId))
    .groupBy(invoices.distributorId, users.businessName, users.name)
    .orderBy(sql`sum(${invoices.amountPaise}) desc`, invoices.distributorId);
  return rows.map((r) => ({
    distributorId: r.distributorId,
    name: r.businessName ?? r.name,
    invoiceCount: r.invoiceCount,
    bagsSold: Number(r.bagsSold),
    invoicedPaise: Number(r.invoicedPaise),
  }));
}
