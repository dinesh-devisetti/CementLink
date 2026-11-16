import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetConfigForTests } from "@/server/config";
import { getGateway } from "@/server/payments/gateway";
import { createRazorpayGateway } from "@/server/payments/razorpay";

const KEYS = ["NODE_ENV", "APP_URL", "DATABASE_URL", "PAYMENT_GATEWAY", "E2E", "VERCEL", "TRUST_PROXY", "RAZORPAY_KEY_ID", "RAZORPAY_KEY_SECRET", "RAZORPAY_WEBHOOK_SECRET"] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const k of KEYS) { saved[k] = process.env[k]; delete process.env[k]; }
  process.env.DATABASE_URL = "file:x.db";
  resetConfigForTests();
});
afterEach(() => {
  for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else (process.env as Record<string, string | undefined>)[k] = saved[k]; }
  resetConfigForTests();
});

describe("getGateway", () => {
  it("refuses the fake gateway without E2E=1", () => {
    process.env.PAYMENT_GATEWAY = "fake";
    expect(() => getGateway()).toThrow(/E2E=1/);
  });
  it("allows the fake gateway with E2E=1 off Vercel", () => {
    process.env.PAYMENT_GATEWAY = "fake";
    process.env.E2E = "1";
    expect(getGateway().kind).toBe("fake");
  });
  it("refuses the fake gateway in a production build unless APP_URL is localhost", () => {
    const env = process.env as Record<string, string | undefined>;
    env.NODE_ENV = "production";
    env.PAYMENT_GATEWAY = "fake";
    env.E2E = "1";
    env.APP_URL = "https://cement.example.com";
    resetConfigForTests();
    expect(() => getGateway()).toThrow(/localhost/);
    env.APP_URL = "http://localhost:3100";
    env.COOKIE_SECURE = "false";
    resetConfigForTests();
    expect(getGateway().kind).toBe("fake");
    delete env.COOKIE_SECURE;
  });
  it("refuses razorpay when not configured", () => {
    process.env.PAYMENT_GATEWAY = "razorpay";
    expect(() => getGateway()).toThrow(/not configured/);
  });
  it("refuses rzp_live_ keys at config parse and in the razorpay adapter", () => {
    process.env.PAYMENT_GATEWAY = "razorpay";
    process.env.RAZORPAY_KEY_ID = "rzp_live_abc";
    process.env.RAZORPAY_KEY_SECRET = "s";
    process.env.RAZORPAY_WEBHOOK_SECRET = "w";
    expect(() => getGateway()).toThrow(/rzp_live_/);
    expect(() => createRazorpayGateway({ keyId: "rzp_live_abc", keySecret: "s", webhookSecret: "w" })).toThrow(/rzp_test_/);
  });
});
