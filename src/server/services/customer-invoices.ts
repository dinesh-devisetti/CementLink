import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { Db } from "../db/client";
import { AppError } from "../errors";
import { activeUser, istDate as istDateSql } from "../db/fragments";
import { assertSql, guardedBatch, isAssertFailure } from "../db/guard";
import type { PaymentStatus, User } from "../db/schema";
import { istDate, todayIst } from "@/lib/dates";
import { invoiceAmountPaise, type CreateCustomerInvoiceInput } from "@/lib/validation/customer-invoices";
import { partyLabel } from "./party-label";

/** Customer invoices (ADR-001 6.8): one per DELIVERED order, created in one guarded batch with the order -> INVOICED move. Money SQL casts binds to INTEGER. */

export type CustomerInvoiceStatus = "ISSUED" | "PAYMENT_REQUESTED" | "PAID";

export interface CustomerInvoiceView {
  id: string;
  orderId: string;
  invoiceNo: string;
  invoiceDate: string;
  qtyKg: number;
  ratePerTonnePaise: number;
  amountPaise: number;
  status: CustomerInvoiceStatus;
  paymentRequestedAt: number | null;
  paidAt: number | null;
  createdAt: number;
  /** Distributor name (customer view) or customer name (distributor view). */
  counterparty: string;
  /** Status of the newest payment attempt, if any. */
  paymentStatus: PaymentStatus | null;
  /** A capture arrived for an attempt that must not be fulfilled (duplicate or wrong amount): refund it in Razorpay. Shown to the distributor only. */
  needsRefund: boolean;
}

const AMOUNT = (kg: unknown, rate: unknown) => sql`(CAST(${kg} AS INTEGER) * CAST(${rate} AS INTEGER) + 500) / 1000`;

export function isInvoiceUniqueViolation(e: unknown): "order" | "no" | null {
  for (let cur: unknown = e, i = 0; cur && i < 6; i += 1) {
    const msg = String((cur as { message?: unknown }).message ?? "");
    if (msg.includes("UNIQUE constraint failed")) {
      if (msg.includes("customer_invoices.order_id")) return "order";
      if (msg.includes("customer_invoices.distributor_id") && msg.includes("customer_invoices.invoice_no")) return "no";
    }
    cur = (cur as { cause?: unknown }).cause;
  }
  return null;
}

const duplicateNo = () => new AppError("DUPLICATE_INVOICE_NO", "Invoice number already used", 409, undefined, { invoiceNo: "Invoice number already used" });
const alreadyInvoiced = () => new AppError("ALREADY_INVOICED", "This order already has an invoice", 409);

async function readOrder(db: Db, distributorId: string, orderId: string) {
  const [o] = await db.all<{ status: string; delivered_at: number | null; qty_kg: number }>(
    sql`SELECT status, delivered_at, qty_kg FROM orders WHERE id = ${orderId} AND distributor_id = ${distributorId}`,
  );
  if (!o) throw new AppError("NOT_FOUND", "Order not found", 404);
  return o;
}

/** Create the invoice for the distributor's own DELIVERED order (C). Qty is copied from the order; amount is computed in SQL; order -> INVOICED in the same batch. */
export async function createCustomerInvoice(db: Db, actor: User, orderId: string, input: CreateCustomerInvoiceInput, now = Date.now()): Promise<{ id: string; amountPaise: number }> {
  const { invoiceNo, invoiceDate, ratePerTonnePaise: rate } = input;
  const o = await readOrder(db, actor.id, orderId);
  if (o.status === "INVOICED" || o.status === "PAID") throw alreadyInvoiced();
  if (o.status !== "DELIVERED" || o.delivered_at === null) throw new AppError("INVALID_STATE", `Order is ${o.status.toLowerCase().replace(/_/g, " ")}; only a delivered order can be invoiced`, 409);
  const deliveredOn = istDate(o.delivered_at);
  if (invoiceDate < deliveredOn) throw new AppError("INVALID_DATE", `Date cannot be before the delivery date (${deliveredOn})`, 422, undefined, { invoiceDate: `Cannot be before ${deliveredOn}` });
  if (invoiceDate > todayIst(new Date(now))) throw new AppError("INVALID_DATE", "Date cannot be in the future", 422, undefined, { invoiceDate: "Cannot be in the future" });
  if (invoiceAmountPaise(o.qty_kg, rate) <= 0) throw new AppError("INVALID_AMOUNT", "Amount must be more than Rs 0", 422, undefined, { ratePerTonne: "Amount must be more than Rs 0" });

  const id = uuidv7();
  try {
    await guardedBatch(db, [
      assertSql(sql`${activeUser(actor.id)}
        AND EXISTS (SELECT 1 FROM orders WHERE id = ${orderId} AND distributor_id = ${actor.id} AND status = 'DELIVERED'
          AND ${invoiceDate} >= ${istDateSql(sql`delivered_at`)})
        AND ${AMOUNT(sql`(SELECT qty_kg FROM orders WHERE id = ${orderId})`, rate)} > 0`),
      sql`INSERT INTO customer_invoices (id, order_id, distributor_id, customer_id, invoice_no, invoice_date, qty_kg, rate_per_tonne_paise, amount_paise, status, created_at)
        SELECT ${id}, o.id, o.distributor_id, o.customer_id, ${invoiceNo}, ${invoiceDate}, o.qty_kg, CAST(${rate} AS INTEGER), ${AMOUNT(sql`o.qty_kg`, rate)}, 'ISSUED', ${now}
        FROM orders o WHERE o.id = ${orderId} AND o.distributor_id = ${actor.id} AND o.status = 'DELIVERED'`,
      sql`UPDATE orders SET status = 'INVOICED', updated_at = ${now} WHERE id = ${orderId} AND status = 'DELIVERED'`,
      assertSql(sql`EXISTS (SELECT 1 FROM customer_invoices WHERE id = ${id}) AND (SELECT status FROM orders WHERE id = ${orderId}) = 'INVOICED'`),
    ]);
  } catch (e) {
    const u = isInvoiceUniqueViolation(e);
    if (u === "order") throw alreadyInvoiced();
    if (u === "no") throw duplicateNo();
    if (!isAssertFailure(e)) throw e;
    const again = await readOrder(db, actor.id, orderId);
    if (again.status === "INVOICED" || again.status === "PAID") throw alreadyInvoiced();
    throw new AppError("CONFLICT", "Could not save the invoice, please retry", 409);
  }
  return { id, amountPaise: invoiceAmountPaise(o.qty_kg, rate) };
}

/** ISSUED -> PAYMENT_REQUESTED (C). The amount was frozen at creation. */
export async function requestPayment(db: Db, actor: User, invoiceId: string, now = Date.now()): Promise<void> {
  const res = await db.run(sql`UPDATE customer_invoices SET status = 'PAYMENT_REQUESTED', payment_requested_at = ${now}
    WHERE id = ${invoiceId} AND distributor_id = ${actor.id} AND status = 'ISSUED' AND ${activeUser(actor.id)}`);
  if (res.rowsAffected > 0) return;
  const [r] = await db.all<{ status: string }>(sql`SELECT status FROM customer_invoices WHERE id = ${invoiceId} AND distributor_id = ${actor.id}`);
  if (!r) throw new AppError("NOT_FOUND", "Invoice not found", 404);
  throw new AppError("INVALID_STATE", r.status === "PAID" ? "This invoice is already paid" : "Payment was already requested", 409);
}

interface Raw {
  id: string; order_id: string; invoice_no: string; invoice_date: string; qty_kg: number; rate: number; amount: number; status: CustomerInvoiceStatus;
  payment_requested_at: number | null; paid_at: number | null; created_at: number; other_id: string; other_business: string | null; other_name: string; pay_status: PaymentStatus | null; needs_refund: number;
}

const SELECT = (role: "CUSTOMER" | "DISTRIBUTOR") => sql`SELECT ci.id, ci.order_id, ci.invoice_no, ci.invoice_date, ci.qty_kg, ci.rate_per_tonne_paise AS rate, ci.amount_paise AS amount, ci.status,
    ci.payment_requested_at, ci.paid_at, ci.created_at, u.id AS other_id, u.business_name AS other_business, u.name AS other_name,
    (SELECT p.status FROM payments p WHERE p.customer_invoice_id = ci.id ORDER BY p.created_at DESC, p.id DESC LIMIT 1) AS pay_status,
    EXISTS (SELECT 1 FROM payments p WHERE p.customer_invoice_id = ci.id AND p.failure_reason LIKE 'NEEDS_REFUND:%') AS needs_refund
  FROM customer_invoices ci JOIN users u ON u.id = ${sql.raw(role === "CUSTOMER" ? "ci.distributor_id" : "ci.customer_id")}`;

const toView = (r: Raw, role: "CUSTOMER" | "DISTRIBUTOR"): CustomerInvoiceView => ({
  id: r.id, orderId: r.order_id, invoiceNo: r.invoice_no, invoiceDate: r.invoice_date, qtyKg: Number(r.qty_kg), ratePerTonnePaise: Number(r.rate), amountPaise: Number(r.amount),
  status: r.status, paymentRequestedAt: r.payment_requested_at === null ? null : Number(r.payment_requested_at), paidAt: r.paid_at === null ? null : Number(r.paid_at),
  createdAt: Number(r.created_at), paymentStatus: r.pay_status, needsRefund: role === "DISTRIBUTOR" && Number(r.needs_refund) === 1,
  counterparty: role === "CUSTOMER" ? partyLabel(r.other_business, "DISTRIBUTOR", r.other_id) : partyLabel(r.other_business, "CUSTOMER", r.other_id, r.other_name),
});

const asRole = (role: string): "CUSTOMER" | "DISTRIBUTOR" => {
  if (role !== "CUSTOMER" && role !== "DISTRIBUTOR") throw new AppError("FORBIDDEN", "Not allowed", 403);
  return role;
};
const ownCol = (role: "CUSTOMER" | "DISTRIBUTOR") => sql.raw(role === "CUSTOMER" ? "ci.customer_id" : "ci.distributor_id");

/** Own invoices, newest first. */
export async function listCustomerInvoices(db: Db, actor: User, { page, limit }: { page: number; limit: number }): Promise<{ rows: CustomerInvoiceView[]; total: number }> {
  const role = asRole(actor.role);
  const rows = await db.all<Raw>(sql`${SELECT(role)} WHERE ${ownCol(role)} = ${actor.id} ORDER BY ci.created_at DESC, ci.id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`);
  const [t] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM customer_invoices ci WHERE ${ownCol(role)} = ${actor.id}`);
  return { rows: rows.map((r) => toView(r, role)), total: Number(t?.n ?? 0) };
}

export interface OrderChainPayment { id: string; status: PaymentStatus; razorpayPaymentId: string | null; amountPaise: number; paidAt: number | null }
export interface OrderChain {
  invoice: CustomerInvoiceView | null;
  payment: OrderChainPayment | null;
  /** Distributor only: provider invoices of this order's POs. Never shown to the customer. */
  providerInvoices: Array<{ id: string; poId: string; invoiceNo: string }>;
}

/** Invoice + latest payment (+ provider invoices for the distributor) of an order the caller owns. The caller has already scoped the order to the actor. */
export async function getOrderChain(db: Db, actor: User, orderId: string): Promise<OrderChain> {
  const role = asRole(actor.role);
  const [inv] = await db.all<Raw>(sql`${SELECT(role)} WHERE ci.order_id = ${orderId} AND ${ownCol(role)} = ${actor.id}`);
  const invoice = inv ? toView(inv, role) : null;
  const [pay] = invoice
    ? await db.all<{ id: string; status: PaymentStatus; rp: string | null; amount: number; paid_at: number | null }>(sql`SELECT id, status, razorpay_payment_id AS rp, amount_paise AS amount, paid_at
        FROM payments WHERE customer_invoice_id = ${invoice.id} ORDER BY (status = 'PAID') DESC, created_at DESC, id DESC LIMIT 1`)
    : [];
  const providerInvoices = role === "DISTRIBUTOR"
    ? await db.all<{ id: string; po_id: string; invoice_no: string }>(sql`SELECT pi.id, pi.po_id, pi.invoice_no FROM provider_invoices pi
        WHERE pi.distributor_id = ${actor.id} AND pi.po_id IN (SELECT i.po_id FROM po_items i WHERE i.order_id = ${orderId}) ORDER BY pi.created_at, pi.id LIMIT 20`)
    : [];
  return {
    invoice,
    payment: pay ? { id: pay.id, status: pay.status, razorpayPaymentId: pay.rp, amountPaise: Number(pay.amount), paidAt: pay.paid_at === null ? null : Number(pay.paid_at) } : null,
    providerInvoices: providerInvoices.map((p) => ({ id: p.id, poId: p.po_id, invoiceNo: p.invoice_no })),
  };
}
