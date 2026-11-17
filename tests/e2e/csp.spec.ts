import { expect, test } from "@playwright/test";

test("V20: security headers present and pages hydrate under CSP without violations", async ({ page }) => {
  const violations: string[] = [];
  page.on("console", (m) => { if (/content security policy/i.test(m.text())) violations.push(m.text()); });
  const res = await page.goto("/login");
  const h = res?.headers() ?? {};
  expect(h["content-security-policy"]).toContain("checkout.razorpay.com");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("DENY");
  await page.getByLabel("Email").fill("ramu@example.com");
  await page.getByLabel("Password").fill("DemoPass123!");
  await page.getByRole("button", { name: "Log in" }).click(); // needs hydrated JS to work
  await expect(page).not.toHaveURL(/\/login$/);
  await page.goto("/customer/invoices");
  await expect(page.getByRole("heading").first()).toBeVisible();
  const api = await page.request.get("/api/payments");
  expect(api.headers()["cache-control"]).toBe("no-store");
  expect(violations).toEqual([]);
});

// Header-only check: proves the policy lists the Razorpay origins, not that the live Checkout.js loads.
test("V20: CSP header lists the Razorpay script and frame origins", async ({ page }) => {
  const csp = (await page.request.get("/login")).headers()["content-security-policy"] ?? "";
  expect(csp).toMatch(/script-src[^;]*https:\/\/checkout\.razorpay\.com/);
  expect(csp).toMatch(/frame-src[^;]*https:\/\/api\.razorpay\.com/);
});
