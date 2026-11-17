import { createHmac } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";

const DEMO = "DemoPass123!";
const WEBHOOK_SECRET = "fake_webhook_secret_e2e_only"; // src/server/payments/signature.ts FAKE_WEBHOOK_SECRET (E2E=1 only)

async function login(browser: Browser, email: string, password = DEMO): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  return page;
}
const future = () => new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);

interface DistRow { distributor: string; salesPaise: number; providers: { provider: string; qtyKg: number }[] }
async function giriStats(admin: Page) {
  const res = await admin.request.get("/api/admin/analytics/distributors?limit=50");
  expect(res.status()).toBe(200);
  const body = (await res.json()) as { data: DistRow[] };
  const giri = body.data.find((d) => d.distributor === "Giri Traders");
  return { sales: giri?.salesPaise ?? 0, anjaniKg: giri?.providers.find((p) => p.provider === "Anjani Cement")?.qtyKg ?? 0 };
}

test("V19: admin analytics numbers match a seeded end-to-end flow", async ({ browser }) => {
  const admin = await login(browser, "admin@example.com", "AdminPass123!");
  const before = await giriStats(admin);

  // Ramu orders 3.125 t from Giri, all via Anjani.
  const ramu = await login(browser, "ramu@example.com");
  await ramu.goto("/customer/orders/new");
  await ramu.getByLabel("Distributor").selectOption({ label: "Giri Traders" });
  await ramu.getByLabel("Total quantity (tonnes)").fill("3.125");
  await ramu.getByRole("button", { name: "Add provider" }).click();
  await ramu.getByLabel("Provider 1", { exact: true }).selectOption({ label: "Anjani Cement" });
  await ramu.getByLabel("Tonnes for provider 1").fill("3.125");
  await ramu.getByLabel("Needed by").fill(future());
  await ramu.getByLabel("Delivery address").fill("Plot 19, Analytics Lane");
  await ramu.getByLabel("City").fill("Hyderabad");
  await ramu.getByLabel("Pincode").fill("500006");
  await ramu.getByRole("button", { name: "Place order" }).click();
  await expect(ramu).toHaveURL(/\/customer\/orders\/(?!new$)[\w-]+$/);
  const orderId = ramu.url().split("/").pop() as string;

  const giri = await login(browser, "giri@example.com");
  await giri.goto(`/distributor/orders/${orderId}`);
  await giri.getByLabel("Select draft 1").check();
  await giri.getByRole("button", { name: "Place selected (1)" }).click();
  await giri.getByRole("button", { name: "Confirm place" }).click();
  await expect(giri.getByText("POs placed", { exact: true })).toBeVisible();

  // Placed POs already count as tonnes ordered, but nothing is sold yet.
  const placed = await giriStats(admin);
  expect(placed.anjaniKg - before.anjaniKg).toBe(3125);
  expect(placed.sales - before.sales).toBe(0);

  const vehicle = `TS09E${String(Date.now()).slice(-6)}`;
  const anjani = await login(browser, "anjani@example.com");
  await anjani.goto("/provider/orders");
  await anjani.getByRole("link", { name: /^3\.125 t - Giri Traders Placed/ }).first().click();
  await anjani.getByRole("button", { name: "Accept" }).click();
  await anjani.getByLabel("Vehicle number (optional)").fill(vehicle);
  await anjani.getByLabel("Driver phone (optional)").fill("9876543211");
  await anjani.getByRole("button", { name: "Mark dispatched" }).click();
  await expect(anjani.getByRole("heading", { name: "New invoice" })).toBeVisible();

  await giri.goto(`/distributor/orders/${orderId}`);
  await giri.getByRole("button", { name: "Mark delivered" }).click();
  await giri.getByRole("button", { name: "Confirm delivered" }).click();
  await expect(giri.getByText("Delivered", { exact: true })).toBeVisible();

  // 3.125 t x Rs 6,400 = Rs 20,000.00 = 2,000,000 paise.
  const no = `A19-${Date.now()}`;
  const form = giri.getByRole("form", { name: "Customer invoice" });
  await form.getByLabel("Invoice no.").fill(no);
  await form.getByLabel("Rate per tonne (Rs)").fill("6400");
  await form.getByRole("button", { name: "Save invoice" }).click();
  await expect(giri.getByText(`Customer invoice ${no}`)).toBeVisible();
  await giri.getByRole("button", { name: "Send payment request" }).click();
  await expect(giri.getByText("Payment requested")).toBeVisible();

  // Invoiced but unpaid: still no sales.
  expect((await giriStats(admin)).sales - before.sales).toBe(0);

  await ramu.goto("/customer/invoices");
  await ramu.getByTestId("customer-invoice-row").filter({ hasText: no }).getByRole("button", { name: /Pay ₹20,000\.00/ }).click();
  const rzp = (await ramu.getByTestId("rzp-order-id").textContent()) as string;
  await ramu.getByRole("button", { name: "Complete test payment" }).click();
  const raw = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_a19", order_id: rzp, amount: 2_000_000, currency: "INR", status: "captured" } } } });
  const hook = await ramu.request.post("/api/webhooks/razorpay", {
    data: raw,
    headers: { "content-type": "application/json", "x-razorpay-signature": createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex"), "x-razorpay-event-id": "evt_a19_paid" },
  });
  expect(hook.status()).toBe(200);
  await expect(ramu.getByTestId("customer-invoice-row").filter({ hasText: no })).toContainText("Paid", { timeout: 15_000 });

  const after = await giriStats(admin);
  expect(after.sales - before.sales).toBe(2_000_000);
  expect(after.anjaniKg - before.anjaniKg).toBe(3125);

  // UI shows the same numbers.
  await admin.goto("/admin/distributors");
  const row = admin.getByTestId("distributor-row").filter({ hasText: "Giri Traders" });
  await expect(row.getByTestId("sales")).toHaveText(new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" }).format(after.sales / 100).replace(/ /g, " "));
  await expect(row.getByTestId("provider-tonnes").filter({ hasText: "Anjani Cement" })).toBeVisible();

  // Transport: the dispatch appears with vehicle, driver and parties.
  await admin.goto("/admin/transport");
  const d = admin.getByTestId("dispatch-row").filter({ hasText: vehicle });
  await expect(d).toContainText("9876543211");
  await expect(d).toContainText("Anjani Cement to Giri Traders");
  await expect(d).toContainText("3.125 t");

  // Customers: Ramu's history lists the new order as Paid.
  await admin.goto("/admin/customers");
  await admin.getByRole("link", { name: "Ramu Constructions" }).click();
  await expect(admin.getByRole("heading", { name: "Ramu Constructions" })).toBeVisible();
  await expect(admin.getByTestId("customer-order-row").filter({ hasText: "3.125 t" }).first()).toContainText("Paid");

  // Non-admins are refused.
  expect((await giri.request.get("/api/admin/dispatches")).status()).toBe(403);
});

test("V19: non-admins are redirected from every admin analytics page; admin past the last page gets a link back", async ({ browser }) => {
  const adminPaths = ["/admin/distributors", "/admin/transport", "/admin/customers", "/admin/customers/anything"];
  for (const email of ["ramu@example.com", "giri@example.com", "anjani@example.com"]) {
    const page = await login(browser, email);
    for (const p of adminPaths) {
      await page.goto(p);
      expect(new URL(page.url()).pathname, `${email} stayed on ${p}`).not.toBe(p);
    }
  }
  const admin = await login(browser, "admin@example.com", "AdminPass123!");
  await admin.goto("/admin/transport?page=999");
  await admin.getByRole("link", { name: /Go to last page/ }).click();
  await expect(admin.getByRole("heading", { name: "Transport" })).toBeVisible();
  await expect(admin).not.toHaveURL(/page=999/);
});
