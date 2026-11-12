import { expect, test, type Browser, type Page } from "@playwright/test";

const DEMO = "DemoPass123!";

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

/** Ramu places an order from Giri and returns its id (taken from the detail URL). */
async function ramuOrders(browser: Browser, tonnes: string, split: Array<[string, string]>): Promise<string> {
  const ramu = await login(browser, "ramu@example.com", { width: 360, height: 740 });
  await ramu.goto("/customer/orders/new");
  await ramu.getByLabel("Distributor").selectOption({ label: "Giri Traders" });
  await ramu.getByLabel("Total quantity (tonnes)").fill(tonnes);
  for (const [i, [provider, qty]] of split.entries()) {
    await ramu.getByRole("button", { name: "Add provider" }).click();
    await ramu.getByLabel(`Provider ${i + 1}`, { exact: true }).selectOption({ label: provider });
    await ramu.getByLabel(`Tonnes for provider ${i + 1}`).fill(qty);
  }
  await ramu.getByLabel("Needed by").fill(future());
  await ramu.getByLabel("Delivery address").fill("Plot 12, Market Road");
  await ramu.getByLabel("City").fill("Hyderabad");
  await ramu.getByLabel("Pincode").fill("500001");
  await ramu.getByRole("button", { name: "Place order" }).click();
  await expect(ramu).toHaveURL(/\/customer\/orders\/(?!new$)[\w-]+$/);
  return ramu.url().split("/").pop() as string;
}

test("Case 1: Ramu 30 t from Giri (Anjani 10 t, Ambuja 20 t) -> Giri opens, 2 drafts, places both -> Anjani sees 10 t PLACED, Ambuja 20 t PLACED, Ramu's address visible", async ({ browser }) => {
  const orderId = await ramuOrders(browser, "30", [["Anjani Cement", "10"], ["Ambuja Cement", "20"]]);

  const giri = await login(browser, "giri@example.com");
  await giri.goto(`/distributor/orders/${orderId}`);
  await expect(giri.getByText("Under review", { exact: true })).toBeVisible();
  await expect(giri.getByRole("heading", { name: "Drafts (2)" })).toBeVisible();
  await expect(giri.getByLabel("Provider for draft 1")).not.toHaveValue("");
  await expect(giri.getByLabel("Provider for draft 2")).not.toHaveValue("");
  await giri.getByLabel("Select draft 1").check();
  await giri.getByLabel("Select draft 2").check();
  await giri.getByRole("button", { name: "Place selected (2)" }).click();
  await giri.getByRole("button", { name: "Confirm place" }).click();
  await expect(giri.getByText("POs placed", { exact: true })).toBeVisible();

  const anjani = await login(browser, "anjani@example.com");
  await anjani.goto("/provider/orders");
  const anjaniCard = anjani.getByRole("link", { name: /^10 t - Giri Traders Placed/ });
  await expect(anjaniCard).toHaveCount(1);
  await anjaniCard.click();
  await expect(anjani).toHaveURL(/\/provider\/orders\/[\w-]+$/);
  await expect(anjani.getByText("Placed", { exact: true })).toBeVisible();
  await expect(anjani.getByText("Plot 12, Market Road, Hyderabad 500001")).toBeVisible();
  await expect(anjani.getByText("Ramu Constructions")).toBeVisible();

  const ambuja = await login(browser, "ambuja@example.com");
  await ambuja.goto("/provider/orders");
  await expect(ambuja.getByRole("link", { name: /^20 t - Giri Traders Placed/ })).toHaveCount(1);
});

test("Case 2: Ramu 15 t no split -> one \"choose provider\" draft -> Giri picks Ambuja, places -> Ambuja sees 15 t PO", async ({ browser }) => {
  const orderId = await ramuOrders(browser, "15", []);

  const giri = await login(browser, "giri@example.com");
  await giri.goto(`/distributor/orders/${orderId}`);
  await expect(giri.getByRole("heading", { name: "Drafts (1)" })).toBeVisible();
  await expect(giri.getByText("Choose a provider before placing.")).toBeVisible();
  await giri.getByLabel("Select draft 1").check();
  await expect(giri.getByRole("button", { name: "Place selected (1)" })).toBeDisabled();
  await expect(giri.getByText("Choose a provider for every selected draft.")).toBeVisible();

  await giri.getByLabel("Provider for draft 1").selectOption({ label: "Ambuja Cement" });
  await expect(giri.getByRole("button", { name: "Place selected (1)" })).toBeEnabled();
  await giri.getByRole("button", { name: "Place selected (1)" }).click();
  await giri.getByRole("button", { name: "Confirm place" }).click();
  await expect(giri.getByText("POs placed", { exact: true })).toBeVisible();

  const ambuja = await login(browser, "ambuja@example.com");
  await ambuja.goto("/provider/orders");
  const card = ambuja.getByRole("link", { name: /^15 t - Giri Traders Placed/ });
  await expect(card).toBeVisible();
  await card.click();
  await expect(ambuja).toHaveURL(/\/provider\/orders\/[\w-]+$/);
  await expect(ambuja.getByText("Placed", { exact: true })).toBeVisible();
  await expect(ambuja.getByText("Plot 12, Market Road, Hyderabad 500001")).toBeVisible();
});
