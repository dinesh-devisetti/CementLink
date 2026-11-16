import { createHmac, createHash, timingSafeEqual } from "node:crypto";

/** HMAC-SHA256 helpers for Razorpay (ADR-001 6.8). Comparison is constant-time and length-safe. */

/** Test-only secrets used by the fake gateway (E2E=1, never on Vercel). */
export const FAKE_KEY_SECRET = "fake_key_secret_e2e_only";
export const FAKE_WEBHOOK_SECRET = "fake_webhook_secret_e2e_only";

export const hmacHex = (secret: string, data: string): string => createHmac("sha256", secret).update(data, "utf8").digest("hex");

export function safeEqualHex(a: string, b: string): boolean {
  if (!/^[0-9a-f]+$/i.test(a) || a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a.toLowerCase(), "hex"), Buffer.from(b.toLowerCase(), "hex"));
}

/** Checkout callback signature: HMAC(key_secret, `${order_id}|${payment_id}`). */
export function verifyCheckoutSignature(keySecret: string, orderId: string, paymentId: string, signature: string): boolean {
  return safeEqualHex(signature, hmacHex(keySecret, `${orderId}|${paymentId}`));
}

/** Webhook signature: HMAC(webhook_secret, raw body) in the X-Razorpay-Signature header. */
export function verifyWebhookSignature(webhookSecret: string, rawBody: string, signature: string | null): boolean {
  return !!signature && safeEqualHex(signature.trim(), hmacHex(webhookSecret, rawBody));
}

export const sha256Hex = (s: string): string => createHash("sha256").update(s, "utf8").digest("hex");
