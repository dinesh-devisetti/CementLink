/**
 * Send a signed Razorpay-style webhook to a running app (test mode only).
 *
 *   npx tsx scripts/send-test-webhook.ts --order order_xxx --amount 6500000 [--event payment.captured|payment.failed]
 *     [--payment pay_xxx] [--event-id evt_xxx] [--url http://localhost:3000] [--currency INR]
 *
 * The secret comes from RAZORPAY_WEBHOOK_SECRET (the same value the app uses); with the fake gateway (E2E=1) and no secret set,
 * the built-in fake test secret is used. It refuses to run with an rzp_live_ key id in the environment.
 */
import "dotenv/config";
import { FAKE_WEBHOOK_SECRET, hmacHex } from "../src/server/payments/signature";

function arg(name: string, fallback?: string): string {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? process.argv[i + 1] : fallback;
  if (!v) {
    console.error(`Missing --${name}`);
    process.exit(1);
  }
  return v;
}

async function main() {
  if ((process.env.RAZORPAY_KEY_ID ?? "").startsWith("rzp_live_")) throw new Error("Refusing to run with a rzp_live_ key: test mode only");
  const secret = process.env.RAZORPAY_WEBHOOK_SECRET || (process.env.E2E === "1" ? FAKE_WEBHOOK_SECRET : "");
  if (!secret) throw new Error("Set RAZORPAY_WEBHOOK_SECRET (or E2E=1 for the fake gateway secret)");
  const amount = Number(arg("amount"));
  if (!Number.isInteger(amount) || amount < 1) throw new Error("--amount must be a positive integer (paise)");
  const event = arg("event", "payment.captured");
  const orderId = arg("order");
  const paymentId = arg("payment", `pay_test_${Date.now()}`);
  const eventId = arg("event-id", `evt_test_${Date.now()}`);
  const url = new URL("/api/webhooks/razorpay", arg("url", process.env.APP_URL ?? "http://localhost:3000"));
  const raw = JSON.stringify({
    event,
    payload: { payment: { entity: { id: paymentId, order_id: orderId, amount, currency: arg("currency", "INR"), status: event === "payment.failed" ? "failed" : "captured", error_description: event === "payment.failed" ? "Test failure" : null } } },
  });
  const res = await fetch(url, { method: "POST", body: raw, headers: { "content-type": "application/json", "x-razorpay-signature": hmacHex(secret, raw), "x-razorpay-event-id": eventId } });
  console.log(res.status, await res.text());
  if (!res.ok) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
