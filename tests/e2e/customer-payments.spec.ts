import { createHmac } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";

const DEMO = "DemoPass123!";
// Same value as src/server/payments/signature.ts FAKE_WEBHOOK_SECRET (the fake gateway secret, E2E=1 only).
const WEBHOOK_SECRET = "fake_webhook_secret_e2e_only";

async function login(browser: Browser, email: string, viewport = { width: 1280, height: 800 }): Promise<Page> {
  const page = await (await browser.newContext({ viewport })).newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(DEMO);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  return page;
}
const future = () => new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);

async function sendWebhook(page: Page, event: string, rzpOrder: string, amount: number, eventId: string, paymentId = "pay_e2e_1") {
  const raw = JSON.stringify({ event, payload: { payment: { entity: { id: paymentId, order_id: rzpOrder, amount, currency: "INR", status: event === "payment.failed" ? "failed" : "captured", error_description: "Test failure" } } } });
  const res = await page.request.post("/api/webhooks/razorpay", {
    data: raw,
    headers: { "content-type": "application/json", "x-razorpay-signature": createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex"), "x-razorpay-event-id": eventId },
  });
  return { status: res.status(), body: (await res.json()) as { data?: { duplicate: boolean; result: string } } };
}

test("V18: invoice -> payment request -> fake gateway -> failure + retry -> signed webhook PAID, duplicate ignored", async ({ browser }) => {
  const ramu = await login(browser, "ramu@example.com", { width: 360, height: 740 });
  await ramu.goto("/customer/orders/new");
  await ramu.getByLabel("Distributor").selectOption({ label: "Giri Traders" });
  await ramu.getByLabel("Total quantity (tonnes)").fill("4");
  await ramu.getByRole("button", { name: "Add provider" }).click();
  await ramu.getByLabel("Provider 1", { exact: true }).selectOption({ label: "Anjani Cement" });
  await ramu.getByLabel("Tonnes for provider 1").fill("4");
  await ramu.getByLabel("Needed by").fill(future());
  await ramu.getByLabel("Delivery address").fill("Plot 18, Invoice Lane");
  await ramu.getByLabel("City").fill("Hyderabad");
  await ramu.getByLabel("Pincode").fill("500005");
  await ramu.getByRole("button", { name: "Place order" }).click();
  await expect(ramu).toHaveURL(/\/customer\/orders\/(?!new$)[\w-]+$/);
  const orderId = ramu.url().split("/").pop() as string;

  const giri = await login(browser, "giri@example.com");
  await giri.goto(`/distributor/orders/${orderId}`);
  await giri.getByLabel("Select draft 1").check();
  await giri.getByRole("button", { name: "Place selected (1)" }).click();
  await giri.getByRole("button", { name: "Confirm place" }).click();
  await expect(giri.getByText("POs placed", { exact: true })).toBeVisible();

  const anjani = await login(browser, "anjani@example.com");
  await anjani.goto("/provider/orders");
  await anjani.getByRole("link", { name: /^4 t - Giri Traders Placed/ }).first().click();
  await anjani.getByRole("button", { name: "Accept" }).click();
  await anjani.getByRole("button", { name: "Mark dispatched" }).click();
  await expect(anjani.getByRole("heading", { name: "New invoice" })).toBeVisible();

  await giri.goto(`/distributor/orders/${orderId}`);
  await giri.getByRole("button", { name: "Mark delivered" }).click();
  await giri.getByRole("button", { name: "Confirm delivered" }).click();
  await expect(giri.getByText("Delivered", { exact: true })).toBeVisible();

  // Giri invoices: 4 t x Rs 6,500 = ₹26,000.00.
  const no = `C18-${Date.now()}`;
  const form = giri.getByRole("form", { name: "Customer invoice" });
  await form.getByLabel("Invoice no.").fill(no);
  await form.getByLabel("Rate per tonne (Rs)").fill("6500");
  await expect(form.getByText(/= ₹26,000\.00/)).toBeVisible();
  await form.getByRole("button", { name: "Save invoice" }).click();
  await expect(giri.getByText(`Customer invoice ${no}`)).toBeVisible();
  await giri.getByRole("button", { name: "Send payment request" }).click();
  await expect(giri.getByText("Payment requested")).toBeVisible();

  // Ramu pays: first attempt fails (signed failure webhook), then retry succeeds.
  await ramu.goto("/customer/invoices");
  const row = ramu.getByTestId("customer-invoice-row").filter({ hasText: no });
  await row.getByRole("button", { name: /Pay ₹26,000\.00/ }).click();
  const first = (await ramu.getByTestId("rzp-order-id").textContent()) as string;
  expect((await sendWebhook(ramu, "payment.failed", first, 2_600_000, "evt_e2e_fail")).status).toBe(200);
  await ramu.reload();
  await ramu.getByTestId("customer-invoice-row").filter({ hasText: no }).getByRole("button", { name: /Pay ₹26,000\.00/ }).click();
  const second = (await ramu.getByTestId("rzp-order-id").textContent()) as string;
  expect(second).not.toBe(first);
  await ramu.getByRole("button", { name: "Complete test payment" }).click();
  await expect(ramu.getByText("Confirming payment...")).toBeVisible();
  // The browser callback alone never marks it paid.
  await giri.goto("/distributor/invoices-out");
  await expect(giri.getByTestId("customer-invoice-row").filter({ hasText: no })).toContainText("Payment requested");

  const bad = await ramu.request.post("/api/webhooks/razorpay", { data: "{}", headers: { "x-razorpay-signature": "0".repeat(64), "x-razorpay-event-id": "evt_e2e_bad" } });
  expect(bad.status()).toBe(401);
  const paid = await sendWebhook(ramu, "payment.captured", second, 2_600_000, "evt_e2e_paid");
  expect(paid.body.data).toEqual({ duplicate: false, result: "paid" });
  const dup = await sendWebhook(ramu, "payment.captured", second, 2_600_000, "evt_e2e_paid");
  expect(dup.body.data?.duplicate).toBe(true);
  await expect(ramu.getByTestId("customer-invoice-row").filter({ hasText: no })).toContainText("Paid", { timeout: 15_000 });
  await expect(ramu.getByRole("button", { name: /Pay ₹/ })).toHaveCount(0);

  await ramu.goto(`/customer/orders/${orderId}`);
  await expect(ramu.getByText("Paid", { exact: true }).first()).toBeVisible();
  await expect(ramu.getByTestId("payment-chip")).toContainText("Paid");
  await ramu.goto("/customer/payments");
  await expect(ramu.getByTestId("payment-row").filter({ hasText: no })).toHaveCount(2);

  await giri.goto("/distributor/invoices-out");
  await expect(giri.getByTestId("customer-invoice-row").filter({ hasText: no })).toContainText("Paid");
  await giri.goto("/distributor/payments");
  await expect(giri.getByTestId("receivable-total")).toBeVisible();
});
