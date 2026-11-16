import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { Db } from "../db/client";
import { AppError } from "../errors";
import { activeUser, istDate as istDateSql } from "../db/fragments";
import { assertSql, guardedBatch, isAssertFailure } from "../db/guard";
import type { PoStatus, User } from "../db/schema";
import { istDate, todayIst } from "@/lib/dates";
import { formatTonnes } from "@/lib/qty";
import { invoiceAmountPaise, type CreateProviderInvoiceInput } from "@/lib/validation/provider-invoices";
import { partyLabel } from "./party-label";

/** Provider invoices (ADR-001 6.5): guarded insert capped by the PO quantity, PO -> INVOICED rollup in the same batch. */

export const PO_INVOICE_PREVIEW = 50;

export interface ProviderInvoiceView {
  id: string;
  poId: string;
  /** Distributor name (provider view) or provider name (distributor view). */
  counterparty: string;
  invoiceNo: string;
  invoiceDate: string;
  qtyKg: number;
  ratePerTonnePaise: number;
  amountPaise: number;
  status: "UNPAID" | "PAID";
  createdAt: number;
}

export interface PoInvoicing {
  poId: string;
  poStatus: PoStatus;
  qtyKg: number;
  ratePerTonnePaise: number | null;
  invoicedKg: number;
  remainingKg: number;
  /** Newest PO_INVOICE_PREVIEW invoices; invoiceCount is the full count. */
  invoices: ProviderInvoiceView[];
  invoiceCount: number;
}

type Role = "PROVIDER" | "DISTRIBUTOR";
function providerOrDistributor(role: string): Role {
  if (role !== "PROVIDER" && role !== "DISTRIBUTOR") throw new AppError("FORBIDDEN", "Not allowed", 403);
  return role;
}

interface RawInvoice {
  id: string;
  po_id: string;
  invoice_no: string;
  invoice_date: string;
  qty_kg: number;
  rate: number;
  amount: number;
  status: "UNPAID" | "PAID";
  created_at: number;
  other_id: string;
  other_business: string | null;
}

export function isUniqueViolation(e: unknown): boolean {
  for (let cur: unknown = e, i = 0; cur && i < 6; i += 1) {
    const msg = String((cur as { message?: unknown }).message ?? "");
    if (msg.includes("UNIQUE constraint failed") && msg.includes("provider_invoices.provider_id") && msg.includes("provider_invoices.invoice_no")) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

const toView = (r: RawInvoice, otherRole: Role): ProviderInvoiceView => ({
  id: r.id,
  poId: r.po_id,
  counterparty: partyLabel(r.other_business, otherRole, r.other_id),
  invoiceNo: r.invoice_no,
  invoiceDate: r.invoice_date,
  qtyKg: Number(r.qty_kg),
  ratePerTonnePaise: Number(r.rate),
  amountPaise: Number(r.amount),
  status: r.status,
  createdAt: Number(r.created_at),
});

const SELECT = (role: Role) => {
  const other = role === "PROVIDER" ? sql.raw("pi.distributor_id") : sql.raw("pi.provider_id");
  return sql`SELECT pi.id, pi.po_id, pi.invoice_no, pi.invoice_date, pi.qty_kg, pi.rate_per_tonne_paise AS rate, pi.amount_paise AS amount, pi.status, pi.created_at,
    u.id AS other_id, u.business_name AS other_business
    FROM provider_invoices pi JOIN users u ON u.id = ${other}`;
};
const ownCol = (role: Role) => sql.raw(role === "PROVIDER" ? "pi.provider_id" : "pi.distributor_id");

interface OwnPo {
  status: PoStatus;
  version: number;
  qty_kg: number;
  total: number | null;
  placed_at: number;
  invoiced_kg: number;
}

/** The provider's own non-DRAFT PO; anything else is 404. */
async function readOwn(db: Db, providerId: string, poId: string): Promise<OwnPo> {
  const [po] = await db.all<OwnPo>(sql`SELECT p.status, p.version, p.qty_kg, p.total_paise AS total, COALESCE(p.placed_at, p.created_at) AS placed_at,
    (SELECT COALESCE(SUM(qty_kg), 0) FROM provider_invoices WHERE po_id = p.id) AS invoiced_kg
    FROM purchase_orders p WHERE p.id = ${poId} AND p.provider_id = ${providerId} AND p.status <> 'DRAFT'`);
  if (!po) throw new AppError("NOT_FOUND", "Purchase order not found", 404);
  return po;
}

const conflict = () => new AppError("CONFLICT", "Could not save the invoice, please retry", 409);
const duplicate = () => new AppError("DUPLICATE_INVOICE_NO", "Invoice number already used", 409, undefined, { invoiceNo: "Invoice number already used" });

/**
 * Create an invoice against a DISPATCHED PO (G). One batch: pre-assert (own PO, DISPATCHED, provider ACTIVE, date >= placed date IST,
 * invoiced kg + this <= PO kg), INSERT with the amount computed in SQL, PO -> INVOICED when the invoiced kg reaches the PO kg, post-assert.
 * The batch is one write transaction, so concurrent inserts cannot jointly exceed the cap. There is no cap on the amount: the rate is free.
 */
export async function createProviderInvoice(db: Db, actor: User, poId: string, input: CreateProviderInvoiceInput, now = Date.now()): Promise<{ id: string; amountPaise: number }> {
  const { invoiceNo, invoiceDate, qtyKg, ratePerTonnePaise } = input;
  const po = await readOwn(db, actor.id, poId);
  if (po.status !== "DISPATCHED") {
    const why = po.status === "INVOICED" || po.status === "PAID" ? "is already fully invoiced" : `is ${po.status.toLowerCase()}; only a dispatched one can be invoiced`;
    throw new AppError("INVALID_STATE", `This purchase order ${why}`, 409);
  }
  const placedOn = istDate(po.placed_at);
  if (invoiceDate < placedOn) throw new AppError("INVALID_DATE", `Date cannot be before the PO placed date (${placedOn})`, 422, undefined, { invoiceDate: `Cannot be before ${placedOn}` });
  if (invoiceDate > todayIst(new Date(now))) throw new AppError("INVALID_DATE", "Date cannot be in the future", 422, undefined, { invoiceDate: "Cannot be in the future" });
  const left = Math.max(0, po.qty_kg - Number(po.invoiced_kg));
  if (qtyKg > left) throw qtyExceeds(left);

  const id = uuidv7();
  try {
    await guardedBatch(db, [
      assertSql(sql`${activeUser(actor.id)}
        AND EXISTS (SELECT 1 FROM purchase_orders WHERE id = ${poId} AND provider_id = ${actor.id} AND status = 'DISPATCHED' AND version = ${po.version}
          AND ${invoiceDate} >= ${istDateSql(sql`COALESCE(placed_at, created_at)`)})
        AND ${qtyKg} + (SELECT COALESCE(SUM(qty_kg), 0) FROM provider_invoices WHERE po_id = ${poId}) <= (SELECT qty_kg FROM purchase_orders WHERE id = ${poId})
        AND (CAST(${qtyKg} AS INTEGER) * CAST(${ratePerTonnePaise} AS INTEGER) + 500) / 1000 > 0`),
      sql`INSERT INTO provider_invoices (id, po_id, provider_id, distributor_id, invoice_no, invoice_date, qty_kg, rate_per_tonne_paise, amount_paise, status, created_at)
        VALUES (${id}, ${poId}, ${actor.id}, (SELECT distributor_id FROM purchase_orders WHERE id = ${poId}), ${invoiceNo}, ${invoiceDate}, ${qtyKg}, ${ratePerTonnePaise},
          (CAST(${qtyKg} AS INTEGER) * CAST(${ratePerTonnePaise} AS INTEGER) + 500) / 1000, 'UNPAID', ${now})`,
      sql`UPDATE purchase_orders SET status = 'INVOICED', updated_at = ${now}, version = version + 1
        WHERE id = ${poId} AND status = 'DISPATCHED' AND (SELECT SUM(qty_kg) FROM provider_invoices WHERE po_id = ${poId}) = qty_kg`,
      assertSql(sql`EXISTS (SELECT 1 FROM provider_invoices WHERE id = ${id})
        AND (SELECT SUM(qty_kg) FROM provider_invoices WHERE po_id = ${poId}) <= (SELECT qty_kg FROM purchase_orders WHERE id = ${poId})
        AND ((SELECT SUM(qty_kg) FROM provider_invoices WHERE po_id = ${poId}) <> (SELECT qty_kg FROM purchase_orders WHERE id = ${poId})
          OR (SELECT status FROM purchase_orders WHERE id = ${poId}) = 'INVOICED')`),
    ]);
  } catch (e) {
    if (isUniqueViolation(e)) throw duplicate();
    if (!isAssertFailure(e)) throw e;
    await diagnose(db, actor.id, poId, input);
    throw conflict();
  }
  return { id, amountPaise: invoiceAmountPaise(qtyKg, ratePerTonnePaise) };
}

const qtyExceeds = (left: number) => {
  const m = left === 0 ? "This purchase order is already fully invoiced" : `Only ${formatTonnes(left)} left to invoice`;
  return new AppError("QTY_EXCEEDS_PO", m, 422, undefined, { qtyTonnes: m });
};

/** After a failed pre-assert (a concurrent change won): re-read and raise the specific error, else the caller raises a generic conflict. */
async function diagnose(db: Db, providerId: string, poId: string, input: CreateProviderInvoiceInput): Promise<void> {
  const po = await readOwn(db, providerId, poId);
  if (po.status !== "DISPATCHED") throw new AppError("INVALID_STATE", "This purchase order can no longer be invoiced", 409);
  const left = Math.max(0, po.qty_kg - Number(po.invoiced_kg));
  if (input.qtyKg > left) throw qtyExceeds(left);
}

/** Own invoices only: a provider sees what it issued, a distributor what it received (read-only). Newest first. */
export async function listProviderInvoices(db: Db, actor: User & { role: string }, { page, limit }: { page: number; limit: number }): Promise<{ rows: ProviderInvoiceView[]; total: number }> {
  const role = providerOrDistributor(actor.role);
  const rows = await db.all<RawInvoice>(sql`${SELECT(role)} WHERE ${ownCol(role)} = ${actor.id} ORDER BY pi.created_at DESC, pi.id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`);
  const [t] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM provider_invoices pi WHERE ${ownCol(role)} = ${actor.id}`);
  const otherRole: Role = role === "PROVIDER" ? "DISTRIBUTOR" : "PROVIDER";
  return { rows: rows.map((r) => toView(r, otherRole)), total: Number(t?.n ?? 0) };
}

/** Invoicing summary of one of the caller's own POs (provider or distributor); anything else is 404. */
export async function getPoInvoicing(db: Db, actor: User & { role: string }, poId: string): Promise<PoInvoicing> {
  const role = providerOrDistributor(actor.role);
  const col = sql.raw(role === "PROVIDER" ? "p.provider_id" : "p.distributor_id");
  const [po] = await db.all<{ status: PoStatus; qty_kg: number; rate: number | null; invoiced_kg: number }>(sql`SELECT p.status, p.qty_kg, p.rate_per_tonne_paise AS rate,
    (SELECT COALESCE(SUM(qty_kg), 0) FROM provider_invoices WHERE po_id = p.id) AS invoiced_kg
    FROM purchase_orders p WHERE p.id = ${poId} AND ${col} = ${actor.id} AND p.status <> 'DRAFT'`);
  if (!po) throw new AppError("NOT_FOUND", "Purchase order not found", 404);
  const rows = await db.all<RawInvoice>(sql`${SELECT(role)} WHERE pi.po_id = ${poId} AND ${ownCol(role)} = ${actor.id} ORDER BY pi.created_at DESC, pi.id DESC LIMIT ${PO_INVOICE_PREVIEW}`);
  const [t] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM provider_invoices pi WHERE pi.po_id = ${poId} AND ${ownCol(role)} = ${actor.id}`);
  const invoicedKg = Number(po.invoiced_kg);
  const otherRole: Role = role === "PROVIDER" ? "DISTRIBUTOR" : "PROVIDER";
  return {
    poId,
    poStatus: po.status,
    qtyKg: Number(po.qty_kg),
    ratePerTonnePaise: po.rate === null ? null : Number(po.rate),
    invoicedKg,
    remainingKg: Math.max(0, Number(po.qty_kg) - invoicedKg),
    invoices: rows.map((r) => toView(r, otherRole)),
    invoiceCount: Number(t?.n ?? 0),
  };
}

