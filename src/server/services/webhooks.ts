import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { z } from "zod";
import type { Db } from "../db/client";
import { AppError } from "../errors";
import { assertSql, guardedBatch, isAssertFailure } from "../db/guard";
import { getWebhookSecret } from "../payments/gateway";
import { sha256Hex, verifyWebhookSignature } from "../payments/signature";

/**
 * Razorpay webhook (ADR-001 6.8): the ONLY place a payment, customer invoice and order become PAID.
 * HMAC over the raw body is verified first; the event row and every state change land in one guarded batch, so a retry after a crash
 * is processed exactly once and a duplicate delivery is a no-op (unique provider_event_id).
 */

export const MAX_WEBHOOK_BYTES = 64 * 1024;

const entity = z.object({ id: z.string().max(64).optional(), order_id: z.string().max(64).nullish(), amount: z.number().int().optional(), amount_paid: z.number().int().optional(), currency: z.string().max(8).optional(), error_description: z.string().max(300).nullish() }).passthrough();
const envelope = z.object({
  event: z.string().max(64),
  payload: z.object({ payment: z.object({ entity }).optional(), order: z.object({ entity }).optional() }).passthrough().optional(),
}).passthrough();

export interface WebhookOutcome { duplicate: boolean; result: string }

/** The one-PAID-per-invoice partial unique index (two captures raced). */
function isPaidUniqueViolation(e: unknown): boolean {
  for (let cur: unknown = e, i = 0; cur && i < 6; i += 1) {
    if (String((cur as { message?: unknown }).message ?? "").includes("UNIQUE constraint failed: payments.customer_invoice_id")) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

/** failure_reason prefix that marks money captured for an attempt that must not be fulfilled; the distributor sees it and refunds in Razorpay. */
export const NEEDS_REFUND = "NEEDS_REFUND:";

function isEventDuplicate(e: unknown): boolean {
  for (let cur: unknown = e, i = 0; cur && i < 6; i += 1) {
    if (String((cur as { message?: unknown }).message ?? "").includes("UNIQUE constraint failed: webhook_events.provider_event_id")) return true;
    cur = (cur as { cause?: unknown }).cause;
  }
  return false;
}

type Kind = "PAID" | "FAILED" | "AUTHORIZED" | "IGNORED";
const KIND: Record<string, Kind> = { "payment.captured": "PAID", "order.paid": "PAID", "payment.failed": "FAILED", "payment.authorized": "AUTHORIZED" };

export async function handleRazorpayWebhook(db: Db, input: { rawBody: string; signature: string | null; eventId: string | null }, now = Date.now()): Promise<WebhookOutcome> {
  if (!verifyWebhookSignature(getWebhookSecret(), input.rawBody, input.signature)) throw new AppError("INVALID_SIGNATURE", "Invalid signature", 401);
  const eventId = input.eventId?.trim();
  if (!eventId || !/^[A-Za-z0-9_.:-]{1,100}$/.test(eventId)) throw new AppError("BAD_REQUEST", "Missing or invalid event id", 400);
  let parsed: z.infer<typeof envelope>;
  try {
    parsed = envelope.parse(JSON.parse(input.rawBody));
  } catch {
    throw new AppError("BAD_REQUEST", "Malformed payload", 400);
  }
  const pay = parsed.payload?.payment?.entity;
  const ord = parsed.payload?.order?.entity;
  const rzpOrderId = pay?.order_id ?? ord?.id ?? null;
  const rzpPaymentId = pay?.id ?? null;
  const amount = pay?.amount ?? ord?.amount_paid ?? null;
  const currency = pay?.currency ?? ord?.currency ?? null;
  const kind = KIND[parsed.event] ?? "IGNORED";

  const event = (result: string) => sql`INSERT INTO webhook_events (id, provider_event_id, event_type, razorpay_order_id, payload_sha256, received_at, processed_at, result)
    VALUES (${uuidv7()}, ${eventId}, ${parsed.event}, ${rzpOrderId}, ${sha256Hex(input.rawBody)}, ${now}, ${now}, ${result})`;
  const done = async (result: string, writes: ReturnType<typeof sql>[] = []): Promise<WebhookOutcome> => {
    try {
      await guardedBatch(db, [event(result), ...writes]);
    } catch (e) {
      if (isEventDuplicate(e)) return { duplicate: true, result: "duplicate" };
      throw e;
    }
    return { duplicate: false, result };
  };

  if (kind === "IGNORED" || !rzpOrderId) return done(kind === "IGNORED" ? "ignored" : "no_order");
  const [p] = await db.all<{ id: string; status: string; amount_paise: number; invoice_id: string }>(
    sql`SELECT id, status, amount_paise, customer_invoice_id AS invoice_id FROM payments WHERE razorpay_order_id = ${rzpOrderId}`);
  if (!p) return done("unknown_order");

  if (kind === "FAILED") {
    if (p.status === "PAID") return done("ignored_already_paid");
    return done("failed", [sql`UPDATE payments SET status = 'FAILED', failure_reason = ${pay?.error_description ?? "payment_failed"}, updated_at = ${now}
      WHERE id = ${p.id} AND status IN ('CREATED','AUTHORIZED')`]);
  }
  if (kind === "AUTHORIZED") {
    return done("authorized", [sql`UPDATE payments SET status = 'AUTHORIZED', razorpay_payment_id = COALESCE(${rzpPaymentId}, razorpay_payment_id), updated_at = ${now} WHERE id = ${p.id} AND status = 'CREATED'`]);
  }

  // PAID: amount and currency must match the immutable amount on the attempt; otherwise only record it.
  if (!rzpPaymentId) return done("malformed");
  const flag = (why: string) => sql`UPDATE payments SET failure_reason = ${NEEDS_REFUND + why}, updated_at = ${now} WHERE id = ${p.id} AND status <> 'PAID'`;
  if (amount !== Number(p.amount_paise) || currency !== "INR") return done("amount_mismatch", [flag("amount_mismatch")]);
  if (p.status === "PAID") return done("already_paid");
  const [other] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM payments WHERE customer_invoice_id = ${p.invoice_id} AND status = 'PAID' AND id <> ${p.id}`);
  if (Number(other?.n ?? 0) > 0) return done("duplicate_payment", [flag("duplicate_payment")]);

  try {
    return await markPaid();
  } catch (e) {
    // A racing capture won between the pre-read and the batch: nothing was written, so record this one as a duplicate payment.
    if (isAssertFailure(e) || isPaidUniqueViolation(e)) return done("duplicate_payment", [flag("duplicate_payment")]);
    throw e;
  }

  function markPaid(): Promise<WebhookOutcome> {
    return done("paid", [
    sql`UPDATE payments SET status = 'PAID', razorpay_payment_id = ${rzpPaymentId}, failure_reason = NULL, paid_at = ${now}, updated_at = ${now}
      WHERE id = ${p.id} AND status <> 'PAID' AND NOT EXISTS (SELECT 1 FROM payments o WHERE o.customer_invoice_id = ${p.invoice_id} AND o.status = 'PAID' AND o.id <> ${p.id})`,
    sql`UPDATE customer_invoices SET status = 'PAID', paid_at = ${now} WHERE id = ${p.invoice_id} AND status = 'PAYMENT_REQUESTED'
      AND EXISTS (SELECT 1 FROM payments WHERE id = ${p.id} AND status = 'PAID')`,
    sql`UPDATE payments SET status = 'FAILED', failure_reason = 'superseded', updated_at = ${now}
      WHERE customer_invoice_id = ${p.invoice_id} AND id <> ${p.id} AND status IN ('CREATED','AUTHORIZED')
        AND EXISTS (SELECT 1 FROM payments WHERE id = ${p.id} AND status = 'PAID')`,
    sql`UPDATE orders SET status = 'PAID', updated_at = ${now} WHERE id = (SELECT order_id FROM customer_invoices WHERE id = ${p.invoice_id}) AND status = 'INVOICED'
      AND (SELECT status FROM customer_invoices WHERE id = ${p.invoice_id}) = 'PAID'`,
    assertSql(sql`(SELECT status FROM payments WHERE id = ${p.id}) = 'PAID' AND (SELECT status FROM customer_invoices WHERE id = ${p.invoice_id}) = 'PAID'`),
    ]);
  }
}
