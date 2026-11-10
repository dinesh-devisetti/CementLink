import { describe, expect, it } from "vitest";
import { parseRupeesToPaise, formatPaise } from "@/lib/money";
import { tonnesToBags, bagsToTonnes, tripsFor } from "@/lib/qty";
import { parseConfig } from "@/server/config";

const base = { DATABASE_URL: "file:./x.db", APP_URL: "http://localhost:3000" };

describe("QA edge: tonnes", () => {
  it.each(["0.03", "1.01", "0.07", "2.5.1", "-1", "", " 1", "1e3", "abc", "0", "0.00", "1,5", "1234567"])("rejects %j", (v) => {
    expect(() => tonnesToBags(v)).toThrow();
  });
  it.each([["0.05", 1], ["1", 20], ["1.5", 30], ["0.1", 2], ["2.25", 45], ["999999.95", 19999999]])("accepts %s", (v, bags) => {
    expect(tonnesToBags(v)).toBe(bags);
  });
  it("round-trips bags", () => {
    for (const b of [1, 7, 20, 33, 100]) expect(tonnesToBags(bagsToTonnes(b))).toBe(b);
  });
  it("tripsFor ceil and guards", () => {
    expect(tripsFor(41, 20)).toBe(3);
    expect(tripsFor(0, 20)).toBe(0);
    expect(() => tripsFor(5, 0)).toThrow();
  });
});

describe("QA edge: money", () => {
  it.each(["385.505", "-1", "", "1e2", ".5", "5.", "1,000", "NaN", "12345678"])("rejects %j", (v) => {
    expect(() => parseRupeesToPaise(v)).toThrow();
  });
  it("parses without float error", () => {
    expect(parseRupeesToPaise("0.29")).toBe(29);
    expect(parseRupeesToPaise("385.5")).toBe(38550);
    expect(parseRupeesToPaise("1.10")).toBe(110);
  });
  it("formats and rejects non-integer paise", () => {
    expect(formatPaise(38550)).toContain("385.50");
    expect(() => formatPaise(10.5)).toThrow();
  });
});

describe("QA edge: config", () => {
  it("rejects live key with uppercase/whitespace variants and non-test keys", () => {
    expect(() => parseConfig({ ...base, RAZORPAY_KEY_ID: "rzp_live_x" })).toThrow(/rzp_live_/);
    expect(() => parseConfig({ ...base, RAZORPAY_KEY_ID: "RZP_LIVE_x" })).toThrow();
    expect(() => parseConfig({ ...base, RAZORPAY_KEY_ID: " rzp_live_x" })).toThrow();
    expect(() => parseConfig({ ...base, RAZORPAY_KEY_ID: "key_123" })).toThrow();
  });
  it("rejects live key even in production with razorpay gateway", () => {
    expect(() => parseConfig({ ...base, NODE_ENV: "production", PAYMENT_GATEWAY: "razorpay", RAZORPAY_KEY_ID: "rzp_live_x" })).toThrow(/rzp_live_/);
  });
  it("rejects short admin seed password and bad numbers", () => {
    expect(() => parseConfig({ ...base, ADMIN_SEED_PASSWORD: "short" })).toThrow();
    expect(() => parseConfig({ ...base, LOGIN_MAX_ATTEMPTS: "0" })).toThrow();
  });
  it("fake gateway allowed in production on localhost-lookalike host?", () => {
    expect(() => parseConfig({ ...base, APP_URL: "http://localhost.evil.com", NODE_ENV: "production" })).toThrow(/fake/);
    expect(() => parseConfig({ ...base, APP_URL: "http://localhost@evil.com", NODE_ENV: "production" })).toThrow(/fake/);
  });
});
