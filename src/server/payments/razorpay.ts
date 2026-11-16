import type { GatewayPayment, PaymentGateway } from "./gateway";
import { verifyCheckoutSignature } from "./signature";
import { AppError } from "../errors";

const API = "https://api.razorpay.com/v1";
const TIMEOUT_MS = 10_000;

/** Razorpay REST via fetch (no SDK). Refuses non-test keys even if config validation was bypassed. */
export function createRazorpayGateway(c: { keyId: string; keySecret: string; webhookSecret: string }): PaymentGateway {
  if (!c.keyId.startsWith("rzp_test_")) throw new AppError("PAYMENTS_UNAVAILABLE", "Only rzp_test_ keys are accepted", 503);
  const auth = `Basic ${Buffer.from(`${c.keyId}:${c.keySecret}`).toString("base64")}`;
  async function call<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${API}${path}`, { ...init, headers: { authorization: auth, "content-type": "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!res.ok) throw new AppError("GATEWAY_ERROR", "The payment provider could not be reached, please retry", 502);
    return (await res.json()) as T;
  }
  return {
    kind: "razorpay",
    keyId: c.keyId,
    webhookSecret: c.webhookSecret,
    async createOrder({ amountPaise, receipt }) {
      const o = await call<{ id?: unknown }>("/orders", { method: "POST", body: JSON.stringify({ amount: amountPaise, currency: "INR", receipt }) });
      if (typeof o.id !== "string" || !o.id) throw new AppError("GATEWAY_ERROR", "Unexpected response from the payment provider", 502);
      return { orderId: o.id };
    },
    async fetchOrderPayments(orderId) {
      const r = await call<{ items?: Array<{ id?: unknown; status?: unknown }> }>(`/orders/${encodeURIComponent(orderId)}/payments`);
      return (r.items ?? []).flatMap((p): GatewayPayment[] =>
        typeof p.id === "string" && ["created", "authorized", "captured", "failed", "refunded"].includes(String(p.status)) ? [{ id: p.id, status: p.status as GatewayPayment["status"] }] : [],
      );
    },
    verifyCheckoutSignature: (o, p, s) => verifyCheckoutSignature(c.keySecret, o, p, s),
  };
}
