import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { Db } from "../db/client";
import { AppError } from "../errors";
import { activeUser } from "../db/fragments";
import type { PaymentStatus, User } from "../db/schema";
import { getGateway } from "../payments/gateway";
import type { VerifyPaymentInput } from "@/lib/validation/customer-invoices";
import { partyLabel } from "./party-label";

/**
 * Customer payment attempts (ADR-001 6.8). The browser can only move an attempt CREATED -> AUTHORIZED (verify) or mark it FAILED (refresh);
 * PAID is set exclusively by the signature-verified webhook (webhooks.ts). No card/UPI data is stored: only Razorpay ids and status.
 */

/** An in-flight attempt without a gateway order after this long is treated as crashed and failed. */
export const STALE_CREATED_MS = 30_000;
/** An AUTHORIZED attempt blocks a new one for this long (the webhook is expected); after that a retry is allowed. */
export const AUTHORIZED_HOLD_MS = 10 * 60_000;

export interface PaymentOrderView {
  paymentId: string;
  razorpayOrderId: string;
  amountPaise: number;
  currency: "INR";
  keyId: string;
  gateway: "razorpay" | "fake";
}
export interface PaymentStatusView { id: string; status: PaymentStatus; invoiceStatus: string; failureReason: string | null }
export interface PaymentHistoryView {
  id: string; invoiceId: string; invoiceNo: string; distributor: string; amountPaise: number; status: PaymentStatus; razorpayPaymentId: string | null; createdAt: number; paidAt: number | null;
}

const customerOnly = (actor: User) => {
  if (actor.role !== "CUSTOMER") throw new AppError("FORBIDDEN", "Not allowed", 403);
};

interface Attempt { id: string; status: PaymentStatus; razorpay_order_id: string | null; amount_paise: number; updated_at: number }
const viewOf = (a: Attempt): { paymentId: string; razorpayOrderId: string; amountPaise: number } => ({ paymentId: a.id, razorpayOrderId: a.razorpay_order_id as string, amountPaise: Number(a.amount_paise) });

function isCreatedUniqueViolation(e: unknown): boolean {
  for (let cur: unknown = e, i = 0; cur && i < 6; i += 1) {
    if (String((cur as { message?: unknown }).message ?? "").includes("UNIQUE constraint failed: payments.customer_invoice_id")) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

const retryShortly = () => new AppError("PAYMENT_IN_PROGRESS", "A payment is being prepared, please retry in a moment", 409);

/** The customer's open attempt for an invoice (CREATED or AUTHORIZED), newest first. */
const openAttempt = async (db: Db, invoiceId: string): Promise<Attempt | undefined> =>
  (await db.all<Attempt>(sql`SELECT id, status, razorpay_order_id, amount_paise, updated_at FROM payments
    WHERE customer_invoice_id = ${invoiceId} AND status IN ('CREATED','AUTHORIZED') ORDER BY created_at DESC, id DESC LIMIT 1`))[0];

/**
 * Start or resume a payment for the customer's own PAYMENT_REQUESTED invoice. Double-click safe: the partial unique index on CREATED
 * serializes attempts, and an existing CREATED attempt with a gateway order is returned as is.
 */
export async function createPaymentOrder(db: Db, actor: User, invoiceId: string, now = Date.now()): Promise<PaymentOrderView> {
  customerOnly(actor);
  const gateway = getGateway();
  const [inv] = await db.all<{ status: string }>(sql`SELECT status FROM customer_invoices WHERE id = ${invoiceId} AND customer_id = ${actor.id}`);
  if (!inv) throw new AppError("NOT_FOUND", "Invoice not found", 404);
  if (inv.status === "PAID") throw new AppError("INVALID_STATE", "This invoice is already paid", 409);
  if (inv.status !== "PAYMENT_REQUESTED") throw new AppError("INVALID_STATE", "The distributor has not requested payment for this invoice yet", 409);

  const reuse = async (): Promise<PaymentOrderView | null> => {
    const open = await openAttempt(db, invoiceId);
    if (!open) return null;
    if (open.status === "AUTHORIZED") {
      if (now - Number(open.updated_at) < AUTHORIZED_HOLD_MS) throw new AppError("PAYMENT_CONFIRMING", "A payment is already being confirmed, please wait", 409);
      return null;
    }
    if (open.razorpay_order_id) return { ...viewOf(open), currency: "INR", keyId: gateway.keyId, gateway: gateway.kind };
    if (now - Number(open.updated_at) < STALE_CREATED_MS) throw retryShortly();
    await db.run(sql`UPDATE payments SET status = 'FAILED', failure_reason = 'abandoned', updated_at = ${now} WHERE id = ${open.id} AND status = 'CREATED' AND razorpay_order_id IS NULL`);
    return null;
  };

  const existing = await reuse();
  if (existing) return existing;

  const id = uuidv7();
  try {
    const res = await db.run(sql`INSERT INTO payments (id, customer_invoice_id, customer_id, distributor_id, amount_paise, currency, status, created_at, updated_at)
      SELECT ${id}, ci.id, ci.customer_id, ci.distributor_id, ci.amount_paise, 'INR', 'CREATED', ${now}, ${now} FROM customer_invoices ci
      WHERE ci.id = ${invoiceId} AND ci.customer_id = ${actor.id} AND ci.status = 'PAYMENT_REQUESTED' AND ${activeUser(actor.id)}
        AND NOT EXISTS (SELECT 1 FROM payments p WHERE p.customer_invoice_id = ci.id AND p.status = 'PAID')`);
    if (res.rowsAffected === 0) throw new AppError("INVALID_STATE", "This invoice cannot be paid right now", 409);
  } catch (e) {
    if (!isCreatedUniqueViolation(e)) throw e;
    const won = await reuse();
    if (won) return won;
    throw retryShortly();
  }

  const [row] = await db.all<{ amount_paise: number }>(sql`SELECT amount_paise FROM payments WHERE id = ${id}`);
  const amountPaise = Number(row?.amount_paise);
  let orderId: string;
  try {
    orderId = (await gateway.createOrder({ amountPaise, receipt: `pay_${id.replace(/-/g, "").slice(-28)}` })).orderId;
  } catch (e) {
    await db.run(sql`UPDATE payments SET status = 'FAILED', failure_reason = 'gateway_error', updated_at = ${now} WHERE id = ${id} AND status = 'CREATED'`);
    throw e;
  }
  const set = await db.run(sql`UPDATE payments SET razorpay_order_id = ${orderId}, updated_at = ${now} WHERE id = ${id} AND status = 'CREATED'`);
  if (set.rowsAffected === 0) throw retryShortly();
  return { paymentId: id, razorpayOrderId: orderId, amountPaise, currency: "INR", keyId: gateway.keyId, gateway: gateway.kind };
}

async function readOwn(db: Db, actor: User, where: ReturnType<typeof sql>) {
  const [p] = await db.all<Attempt & { razorpay_payment_id: string | null; failure_reason: string | null; invoice_status: string }>(
    sql`SELECT p.id, p.status, p.razorpay_order_id, p.razorpay_payment_id, p.amount_paise, p.updated_at, p.failure_reason, ci.status AS invoice_status
      FROM payments p JOIN customer_invoices ci ON ci.id = p.customer_invoice_id WHERE p.customer_id = ${actor.id} AND ${where}`);
  if (!p) throw new AppError("NOT_FOUND", "Payment not found", 404);
  return p;
}

/**
 * Checkout callback. Verifies the signature and records AUTHORIZED only. It can never set PAID: the invoice and order
 * become paid only through the webhook, so a forged or replayed callback cannot mark anything paid.
 */
export async function verifyPayment(db: Db, actor: User, input: VerifyPaymentInput, now = Date.now()): Promise<PaymentStatusView> {
  customerOnly(actor);
  const p = await readOwn(db, actor, sql`p.razorpay_order_id = ${input.razorpayOrderId}`);
  if (!getGateway().verifyCheckoutSignature(input.razorpayOrderId, input.razorpayPaymentId, input.razorpaySignature)) {
    throw new AppError("BAD_SIGNATURE", "Payment could not be verified", 400);
  }
  try {
    await db.run(sql`UPDATE payments SET status = 'AUTHORIZED', razorpay_payment_id = ${input.razorpayPaymentId}, updated_at = ${now} WHERE id = ${p.id} AND status = 'CREATED'`);
  } catch (e) {
    if (String((e as { message?: unknown }).message ?? "").includes("UNIQUE constraint failed: payments.razorpay_payment_id")) throw new AppError("CONFLICT", "This payment id is already recorded", 409);
    throw e;
  }
  return paymentStatus(db, actor, p.id);
}

/** Poll target: own attempt status plus the invoice status. */
export async function paymentStatus(db: Db, actor: User, paymentId: string): Promise<PaymentStatusView> {
  customerOnly(actor);
  const p = await readOwn(db, actor, sql`p.id = ${paymentId}`);
  return { id: p.id, status: p.status, invoiceStatus: p.invoice_status, failureReason: p.failure_reason };
}

/**
 * Ask the gateway what it knows about an open attempt. Read-only for money: it may move CREATED -> AUTHORIZED or an open attempt -> FAILED
 * (so the customer can retry after a lost webhook) but never PAID.
 */
export async function refreshPayment(db: Db, actor: User, paymentId: string, now = Date.now()): Promise<PaymentStatusView> {
  customerOnly(actor);
  const p = await readOwn(db, actor, sql`p.id = ${paymentId}`);
  if ((p.status === "CREATED" || p.status === "AUTHORIZED") && p.razorpay_order_id) {
    const seen = await getGateway().fetchOrderPayments(p.razorpay_order_id);
    const live = seen.some((x) => x.status === "authorized" || x.status === "captured");
    if (live && p.status === "CREATED") {
      await db.run(sql`UPDATE payments SET status = 'AUTHORIZED', updated_at = ${now} WHERE id = ${p.id} AND status = 'CREATED'`);
    } else if (!live && seen.some((x) => x.status === "failed")) {
      await db.run(sql`UPDATE payments SET status = 'FAILED', failure_reason = 'gateway_reported_failure', updated_at = ${now} WHERE id = ${p.id} AND status IN ('CREATED','AUTHORIZED')`);
    }
  }
  return paymentStatus(db, actor, p.id);
}

/** Own payment history, newest first. */
export async function listPayments(db: Db, actor: User, { page, limit }: { page: number; limit: number }): Promise<{ rows: PaymentHistoryView[]; total: number }> {
  customerOnly(actor);
  const rows = await db.all<{ id: string; invoice_id: string; invoice_no: string; d_id: string; d_business: string | null; amount: number; status: PaymentStatus; rp: string | null; created_at: number; paid_at: number | null }>(
    sql`SELECT p.id, ci.id AS invoice_id, ci.invoice_no, u.id AS d_id, u.business_name AS d_business, p.amount_paise AS amount, p.status, p.razorpay_payment_id AS rp, p.created_at, p.paid_at
      FROM payments p JOIN customer_invoices ci ON ci.id = p.customer_invoice_id JOIN users u ON u.id = p.distributor_id
      WHERE p.customer_id = ${actor.id} ORDER BY p.created_at DESC, p.id DESC LIMIT ${limit} OFFSET ${(page - 1) * limit}`);
  const [t] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM payments WHERE customer_id = ${actor.id}`);
  return {
    total: Number(t?.n ?? 0),
    rows: rows.map((r) => ({
      id: r.id, invoiceId: r.invoice_id, invoiceNo: r.invoice_no, distributor: partyLabel(r.d_business, "DISTRIBUTOR", r.d_id), amountPaise: Number(r.amount), status: r.status,
      razorpayPaymentId: r.rp, createdAt: Number(r.created_at), paidAt: r.paid_at === null ? null : Number(r.paid_at),
    })),
  };
}
