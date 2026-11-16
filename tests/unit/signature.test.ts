import { describe, expect, it } from "vitest";
import { hmacHex, safeEqualHex, verifyCheckoutSignature, verifyWebhookSignature } from "@/server/payments/signature";

// Vectors computed independently with `openssl dgst -sha256 -hmac`.
const CHECKOUT = "52115a0d3400de9e86aade1f1b6eba9e8974604f4e267a9e9a16633a4c8dd2cb";
const WEBHOOK = "19373ef0e8c66f206e49d251e4402291615bbce6ef00922e94a47a213fb76ee1";

describe("signature", () => {
  it("matches known HMAC-SHA256 vectors", () => {
    expect(hmacHex("secret", "order_1|pay_1")).toBe(CHECKOUT);
    expect(hmacHex("whsec", '{"a":1}')).toBe(WEBHOOK);
  });
  it("verifies checkout signatures and rejects tampering", () => {
    expect(verifyCheckoutSignature("secret", "order_1", "pay_1", CHECKOUT)).toBe(true);
    expect(verifyCheckoutSignature("secret", "order_1", "pay_2", CHECKOUT)).toBe(false);
    expect(verifyCheckoutSignature("other", "order_1", "pay_1", CHECKOUT)).toBe(false);
  });
  it("verifies webhook signatures over the exact raw body", () => {
    expect(verifyWebhookSignature("whsec", '{"a":1}', WEBHOOK)).toBe(true);
    expect(verifyWebhookSignature("whsec", '{"a": 1}', WEBHOOK)).toBe(false);
    expect(verifyWebhookSignature("whsec", '{"a":1}', null)).toBe(false);
    expect(verifyWebhookSignature("whsec", '{"a":1}', "")).toBe(false);
  });
  it("safeEqualHex is length- and charset-safe", () => {
    expect(safeEqualHex("zz", "zz")).toBe(false);
    expect(safeEqualHex("ab", "abcd")).toBe(false);
    expect(safeEqualHex("AB", "ab")).toBe(true);
  });
});
