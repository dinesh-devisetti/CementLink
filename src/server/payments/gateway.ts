import { getConfig } from "../config";
import { AppError } from "../errors";
import { createFakeGateway } from "./fake";
import { createRazorpayGateway } from "./razorpay";

/** Payment gateway port. Test mode only: rzp_live_ keys are refused here as well as at config parse. */
export interface GatewayPayment {
  id: string;
  status: "created" | "authorized" | "captured" | "failed" | "refunded";
}
export interface PaymentGateway {
  readonly kind: "razorpay" | "fake";
  /** Public key id for Checkout (never the secret). */
  readonly keyId: string;
  createOrder(input: { amountPaise: number; receipt: string }): Promise<{ orderId: string }>;
  /** Read-only: payments the gateway reports for an order. Used by refresh, which never marks PAID. */
  fetchOrderPayments(orderId: string): Promise<GatewayPayment[]>;
  verifyCheckoutSignature(orderId: string, paymentId: string, signature: string): boolean;
  readonly webhookSecret: string;
}

let override: PaymentGateway | undefined;
export const setGatewayForTests = (g: PaymentGateway | undefined): void => {
  override = g;
};

const unavailable = (why: string) => new AppError("PAYMENTS_UNAVAILABLE", `Online payments are not available: ${why}`, 503);

const isLocalUrl = (u: string): boolean => {
  try {
    return ["localhost", "127.0.0.1"].includes(new URL(u).hostname);
  } catch {
    return false;
  }
};

/** fake needs E2E=1 and no VERCEL; razorpay needs rzp_test_ key id, secret and webhook secret. */
export function getGateway(): PaymentGateway {
  if (override) return override;
  const c = getConfig();
  if (c.PAYMENT_GATEWAY === "fake") {
    if (c.E2E !== "1" || c.VERCEL) throw unavailable("the fake gateway is only allowed with E2E=1 outside Vercel");
    if (c.NODE_ENV === "production" && !isLocalUrl(c.APP_URL)) throw unavailable("the fake gateway is only allowed on localhost in production builds");
    return createFakeGateway(c.RAZORPAY_WEBHOOK_SECRET);
  }
  const { RAZORPAY_KEY_ID: id, RAZORPAY_KEY_SECRET: secret, RAZORPAY_WEBHOOK_SECRET: hook } = c;
  if (!id || !secret || !hook) throw unavailable("Razorpay is not configured");
  if (!id.startsWith("rzp_test_")) throw unavailable("only rzp_test_ keys are accepted");
  return createRazorpayGateway({ keyId: id, keySecret: secret, webhookSecret: hook });
}

/** Webhook secret without needing a full gateway (fake works with E2E only). */
export const getWebhookSecret = (): string => getGateway().webhookSecret;
