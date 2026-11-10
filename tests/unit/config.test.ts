import { describe, expect, it } from "vitest";
import { parseConfig } from "@/server/config";

const base = { DATABASE_URL: "file:./x.db", APP_URL: "http://localhost:3000" };

describe("parseConfig", () => {
  it("applies defaults", () => {
    const c = parseConfig({ ...base, NODE_ENV: "test" });
    expect(c.SESSION_TTL_HOURS).toBe(168);
    expect(c.LOGIN_MAX_ATTEMPTS).toBe(5);
    expect(c.LOGIN_WINDOW_MINUTES).toBe(15);
    expect(c.LOGIN_IP_MAX_ATTEMPTS).toBe(50);
    expect(c.PAYMENT_GATEWAY).toBe("fake");
  });
  it("rejects rzp_live_ keys", () => {
    expect(() => parseConfig({ ...base, RAZORPAY_KEY_ID: "rzp_live_abc" })).toThrow(/rzp_live_/);
  });
  it("accepts rzp_test_ keys", () => {
    expect(parseConfig({ ...base, RAZORPAY_KEY_ID: "rzp_test_abc" }).RAZORPAY_KEY_ID).toBe("rzp_test_abc");
  });
  it("production requires APP_URL and PAYMENT_GATEWAY, with no hostname-based exemptions", () => {
    const prod = { DATABASE_URL: "file:./x.db", NODE_ENV: "production" };
    expect(() => parseConfig({ ...prod, PAYMENT_GATEWAY: "razorpay" })).toThrow(/APP_URL/);
    expect(() => parseConfig({ ...prod, APP_URL: "https://a.example.com" })).toThrow(/PAYMENT_GATEWAY/);
    expect(() => parseConfig({ ...prod, APP_URL: "https://a.example.com", PAYMENT_GATEWAY: "fake" })).toThrow(/fake/);
    expect(() => parseConfig({ ...prod, APP_URL: "http://localhost:3000", PAYMENT_GATEWAY: "fake" })).toThrow(/fake/);
    expect(parseConfig({ ...prod, APP_URL: "https://a.example.com", PAYMENT_GATEWAY: "razorpay" }).PAYMENT_GATEWAY).toBe("razorpay");
  });
  it("fake gateway and insecure cookies in production need explicit E2E=1, never on Vercel", () => {
    const prod = { DATABASE_URL: "file:./x.db", NODE_ENV: "production", APP_URL: "http://localhost:3100", PAYMENT_GATEWAY: "fake", COOKIE_SECURE: "false" };
    expect(() => parseConfig({ ...prod, PAYMENT_GATEWAY: "razorpay" })).toThrow(/COOKIE_SECURE/);
    expect(parseConfig({ ...prod, E2E: "1" }).PAYMENT_GATEWAY).toBe("fake");
    expect(() => parseConfig({ ...prod, E2E: "1", VERCEL: "1" })).toThrow(/Vercel/);
  });
  it("requires TRUST_PROXY=true when VERCEL is set", () => {
    expect(() => parseConfig({ ...base, VERCEL: "1" })).toThrow(/TRUST_PROXY/);
    expect(() => parseConfig({ ...base, VERCEL: "1", TRUST_PROXY: "false" })).toThrow(/TRUST_PROXY/);
    expect(parseConfig({ ...base, VERCEL: "1", TRUST_PROXY: "true" }).TRUST_PROXY).toBe("true");
  });
  it("requires DATABASE_URL", () => {
    expect(() => parseConfig({ APP_URL: "http://x.com" })).toThrow();
  });
});
