import { sql, type SQL } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { Db } from "../db/client";
import { AppError } from "../errors";
import { activeUser } from "../db/fragments";
import { assertSql, guardedBatch, isAssertFailure } from "../db/guard";
import type { User } from "../db/schema";
import { todayIst } from "@/lib/dates";
import { formatPaise } from "@/lib/money";
import type { CreateProviderPaymentInput } from "@/lib/validation/provider-payments";
import { partyLabel } from "./party-label";

/** Manual provider payments (ADR-001 6.7). Immutable: this module has no update or delete. Money SQL casts binds to INTEGER (libsql binds JS numbers as REAL). */

type Role = "PROVIDER" | "DISTRIBUTOR";
function providerOrDistributor(role: string): Role {
  if (role !== "PROVIDER" && role !== "DISTRIBUTOR") throw new AppError("FORBIDDEN", "Not allowed", 403);
  return role;
}

export interface ProviderPaymentView {
  id: string;
  invoiceId: string;
  invoiceNo: string;
  counterparty: string;
  amountPaise: number;
  paidOn: string;
  mode: string;
  reference: string | null;
  createdAt: number;
}

export interface InvoiceBalanceView {
  id: string;
  poId: string;
  invoiceNo: string;
  invoiceDate: string;
  counterparty: string;
  amountPaise: number;
  paidPaise: number;
  outstandingPaise: number;
}

const exceeds = (left: number) => {
  const m = left === 0 ? "This invoice is already fully paid" : `Only ${formatPaise(left)} is outstanding on this invoice`;
  return new AppError("AMOUNT_EXCEEDS_OUTSTANDING", m, 422, undefined, { amount: m });
};
/** `inv` must be a SQL column reference or bound value, never a raw string. */
const PAID_SUM = (inv: SQL) => sql`(SELECT COALESCE(SUM(amount_paise), 0) FROM provider_payments WHERE provider_invoice_id = ${inv})`;

interface OwnInvoice { amount: number; invoice_date: string; status: string; po_id: string; provider_id: string; paid: number }
async function readOwn(db: Db, distributorId: string, invoiceId: string): Promise<OwnInvoice> {
  const [r] = await db.all<OwnInvoice>(sql`SELECT amount_paise AS amount, invoice_date, status, po_id, provider_id, ${PAID_SUM(sql`provider_invoices.id`)} AS paid
    FROM provider_invoices WHERE id = ${invoiceId} AND distributor_id = ${distributorId}`);
  if (!r) throw new AppError("NOT_FOUND", "Invoice not found", 404);
  return r;
}

/**
 * Record a payment (C): one guarded batch. Pre-assert (own invoice, actor ACTIVE, date window, amount + paid <= invoice amount) -> INSERT ->
 * invoice PAID when payments reach the amount -> PO PAID when INVOICED and no invoice is left unpaid -> post-assert paid <= amount.
 */
export async function createProviderPayment(db: Db, actor: User, invoiceId: string, input: CreateProviderPaymentInput, now = Date.now()): Promise<{ id: string; outstandingPaise: number }> {
  const { amountPaise, paidOn, mode, reference } = input;
  const inv = await readOwn(db, actor.id, invoiceId);
  if (paidOn < inv.invoice_date) throw new AppError("INVALID_DATE", `Date cannot be before the invoice date (${inv.invoice_date})`, 422, undefined, { paidOn: `Cannot be before ${inv.invoice_date}` });
  if (paidOn > todayIst(new Date(now))) throw new AppError("INVALID_DATE", "Date cannot be in the future", 422, undefined, { paidOn: "Cannot be in the future" });
  const left = Math.max(0, Number(inv.amount) - Number(inv.paid));
  if (amountPaise > left) throw exceeds(left);

  const id = uuidv7();
  const amt = sql`CAST(${amountPaise} AS INTEGER)`;
  try {
    await guardedBatch(db, [
      assertSql(sql`${activeUser(actor.id)}
        AND EXISTS (SELECT 1 FROM provider_invoices WHERE id = ${invoiceId} AND distributor_id = ${actor.id} AND invoice_date <= ${paidOn}
          AND ${amt} + ${PAID_SUM(sql`provider_invoices.id`)} <= amount_paise)`),
      sql`INSERT INTO provider_payments (id, provider_invoice_id, provider_id, distributor_id, amount_paise, paid_on, mode, reference, created_by, created_at)
        SELECT ${id}, id, provider_id, distributor_id, ${amt}, ${paidOn}, ${mode}, ${reference}, ${actor.id}, ${now} FROM provider_invoices WHERE id = ${invoiceId} AND distributor_id = ${actor.id}`,
      sql`UPDATE provider_invoices SET status = 'PAID', paid_at = ${now}
        WHERE id = ${invoiceId} AND status = 'UNPAID' AND ${PAID_SUM(sql`provider_invoices.id`)} >= amount_paise`,
      sql`UPDATE purchase_orders SET status = 'PAID', updated_at = ${now}, version = version + 1
        WHERE id = (SELECT po_id FROM provider_invoices WHERE id = ${invoiceId}) AND status = 'INVOICED'
          AND NOT EXISTS (SELECT 1 FROM provider_invoices WHERE po_id = purchase_orders.id AND status <> 'PAID')`,
      assertSql(sql`EXISTS (SELECT 1 FROM provider_payments WHERE id = ${id})
        AND ${PAID_SUM(sql`${invoiceId}`)} <= (SELECT amount_paise FROM provider_invoices WHERE id = ${invoiceId})`),
    ]);
  } catch (e) {
    if (!isAssertFailure(e)) throw e;
    const again = await readOwn(db, actor.id, invoiceId);
    const l = Math.max(0, Number(again.amount) - Number(again.paid));
    if (amountPaise > l) throw exceeds(l);
    throw new AppError("CONFLICT", "Could not save the payment, please retry", 409);
  }
  const after = await readOwn(db, actor.id, invoiceId);
  return { id, outstandingPaise: Math.max(0, Number(after.amount) - Number(after.paid)) };
}

const ownCol = (role: Role, alias: string) => sql.raw(`${alias}.${role === "PROVIDER" ? "provider_id" : "distributor_id"}`);
const otherCol = (role: Role, alias: string) => sql.raw(`${alias}.${role === "PROVIDER" ? "distributor_id" : "provider_id"}`);

interface RawPayment { id: string; invoice_id: string; invoice_no: string; other_id: string; other_business: string | null; amount: number; paid_on: string; mode: string; reference: string | null; created_at: number }

/** Own receipts (provider) or payments made (distributor), newest first. `counterpartyId` narrows to one counterparty. */
export async function listProviderPayments(db: Db, actor: User & { role: string }, { page, limit, counterpartyId }: { page: number; limit: number; counterpartyId?: string }): Promise<{ rows: ProviderPaymentView[]; total: number }> {
  const role = providerOrDistributor(actor.role);
  const narrow = counterpartyId ? sql` AND ${otherCol(role, "pp")} = ${counterpartyId}` : sql``;
  const rows = await db.all<RawPayment>(sql`SELECT pp.id, pp.provider_invoice_id AS invoice_id, pi.invoice_no, u.id AS other_id, u.business_name AS other_business, pp.amount_paise AS amount, pp.paid_on, pp.mode, pp.reference, pp.created_at
    FROM provider_payments pp JOIN provider_invoices pi ON pi.id = pp.provider_invoice_id JOIN users u ON u.id = ${otherCol(role, "pp")}
    WHERE ${ownCol(role, "pp")} = ${actor.id}${narrow} ORDER BY pp.created_at DESC, pp.id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`);
  const [t] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM provider_payments pp WHERE ${ownCol(role, "pp")} = ${actor.id}${narrow}`);
  const otherRole: Role = role === "PROVIDER" ? "DISTRIBUTOR" : "PROVIDER";
  return {
    total: Number(t?.n ?? 0),
    rows: rows.map((r) => ({
      id: r.id, invoiceId: r.invoice_id, invoiceNo: r.invoice_no, counterparty: partyLabel(r.other_business, otherRole, r.other_id),
      amountPaise: Number(r.amount), paidOn: r.paid_on, mode: r.mode, reference: r.reference, createdAt: Number(r.created_at),
    })),
  };
}

interface RawBal { id: string; po_id: string; invoice_no: string; invoice_date: string; other_id: string; other_business: string | null; amount: number; paid: number }

/** Own invoices with paid and outstanding amounts. `onlyOutstanding` keeps unpaid ones (the distributor's pay list). Newest 50. */
export async function listInvoiceBalances(db: Db, actor: User & { role: string }, opts: { onlyOutstanding?: boolean; counterpartyId?: string } = {}): Promise<InvoiceBalanceView[]> {
  const role = providerOrDistributor(actor.role);
  const more = sql`${opts.onlyOutstanding ? sql` AND pi.status = 'UNPAID'` : sql``}${opts.counterpartyId ? sql` AND ${otherCol(role, "pi")} = ${opts.counterpartyId}` : sql``}`;
  const rows = await db.all<RawBal>(sql`SELECT pi.id, pi.po_id, pi.invoice_no, pi.invoice_date, u.id AS other_id, u.business_name AS other_business, pi.amount_paise AS amount, ${PAID_SUM(sql`pi.id`)} AS paid
    FROM provider_invoices pi JOIN users u ON u.id = ${otherCol(role, "pi")}
    WHERE ${ownCol(role, "pi")} = ${actor.id}${more} ORDER BY pi.created_at DESC, pi.id DESC LIMIT 50`);
  const otherRole: Role = role === "PROVIDER" ? "DISTRIBUTOR" : "PROVIDER";
  return rows.map((r) => ({
    id: r.id, poId: r.po_id, invoiceNo: r.invoice_no, invoiceDate: r.invoice_date, counterparty: partyLabel(r.other_business, otherRole, r.other_id),
    amountPaise: Number(r.amount), paidPaise: Number(r.paid), outstandingPaise: Number(r.amount) - Number(r.paid),
  }));
}
