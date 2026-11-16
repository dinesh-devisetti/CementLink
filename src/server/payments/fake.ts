import { randomUUID } from "node:crypto";
import type { PaymentGateway } from "./gateway";
import { FAKE_KEY_SECRET, FAKE_WEBHOOK_SECRET, verifyCheckoutSignature } from "./signature";

/** In-process stand-in for E2E: no network. The browser may send the literal signature FAKE_CHECKOUT_SIGNATURE (AUTHORIZED only; PAID still needs a signed webhook). */
export const FAKE_CHECKOUT_SIGNATURE = "fake_checkout_signature";

/** The hardcoded test secret is only ever usable under E2E=1 or the vitest runner. */
function fallbackSecret(): string {
  if (process.env.E2E !== "1" && process.env.NODE_ENV !== "test") throw new Error("The fake webhook secret is only available in test/E2E");
  return FAKE_WEBHOOK_SECRET;
}

export function createFakeGateway(webhookSecret?: string): PaymentGateway {
  return {
    kind: "fake",
    keyId: "rzp_test_fake",
    webhookSecret: webhookSecret || fallbackSecret(),
    async createOrder() {
      return { orderId: `order_fake_${randomUUID().replace(/-/g, "").slice(0, 16)}` };
    },
    async fetchOrderPayments() {
      return [];
    },
    verifyCheckoutSignature(orderId, paymentId, signature) {
      return signature === FAKE_CHECKOUT_SIGNATURE || verifyCheckoutSignature(FAKE_KEY_SECRET, orderId, paymentId, signature);
    },
  };
}
