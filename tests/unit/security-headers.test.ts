import { describe, expect, it } from "vitest";
import { buildCsp, securityHeaders } from "../../src/lib/security-headers";

const get = (list: { key: string; value: string }[], k: string) => list.find((h) => h.key === k)?.value;

describe("security headers", () => {
  it("CSP allows Razorpay Checkout and locks down framing/objects/base", () => {
    const csp = buildCsp(false);
    expect(csp).toContain("script-src 'self' 'unsafe-inline' https://checkout.razorpay.com");
    expect(csp).toContain("frame-src https://api.razorpay.com https://checkout.razorpay.com");
    expect(csp).toContain("connect-src 'self' https://api.razorpay.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).not.toContain("unsafe-eval");
  });
  it("dev CSP adds unsafe-eval only in development", () => {
    expect(buildCsp(true)).toContain("'unsafe-eval'");
    expect(buildCsp(true)).toMatch(/connect-src[^;]* ws:/);
    expect(buildCsp(false)).not.toMatch(/ ws:/);
  });
  it("sets the standard headers; HSTS only in production", () => {
    const prod = securityHeaders(false, true);
    expect(get(prod, "X-Content-Type-Options")).toBe("nosniff");
    expect(get(prod, "X-Frame-Options")).toBe("DENY");
    expect(get(prod, "Referrer-Policy")).toBe("strict-origin-when-cross-origin");
    expect(get(prod, "Permissions-Policy")).toContain("camera=()");
    expect(get(prod, "Strict-Transport-Security")).toContain("max-age=");
    expect(get(prod, "Content-Security-Policy")).toBeTruthy();
    expect(get(securityHeaders(true, false), "Strict-Transport-Security")).toBeUndefined();
  });
});
