import { expect, test, type Browser, type Page } from "@playwright/test";

const DEMO = "DemoPass123!";

async function login(browser: Browser, email: string, viewport = { width: 360, height: 740 }): Promise<Page> {
  const page = await (await browser.newContext({ viewport })).newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(DEMO);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  return page;
}

const future = () => new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);

async function fillAddress(page: Page) {
  await page.getByLabel("Needed by").fill(future());
  await page.getByLabel("Delivery address").fill("Plot 12, Market Road");
  await page.getByLabel("City").fill("Hyderabad");
  await page.getByLabel("Pincode").fill("500001");
}

test("Ramu orders 30 t split 10 + 20 at 360px, sees it listed, and the distributor sees it read only", async ({ browser }) => {
  const ramu = await login(browser, "ramu@example.com");
  await ramu.goto("/customer/orders/new");
  await ramu.getByLabel("Distributor").selectOption({ label: "Giri Traders" });
  await ramu.getByLabel("Total quantity (tonnes)").fill("30");
  await expect(ramu.getByTestId("unallocated")).toHaveText("Unallocated: 30 t -> distributor's choice");

  await ramu.getByRole("button", { name: "Add provider" }).click();
  await ramu.getByLabel("Provider 1", { exact: true }).selectOption({ label: "Anjani Cement" });
  await ramu.getByLabel("Tonnes for provider 1").fill("10");
  await expect(ramu.getByTestId("unallocated")).toHaveText("Unallocated: 20 t -> distributor's choice");
  await ramu.getByRole("button", { name: "Add provider" }).click();
  await ramu.getByLabel("Provider 2", { exact: true }).selectOption({ label: "Ambuja Cement" });
  await ramu.getByLabel("Tonnes for provider 2").fill("20");
  await expect(ramu.getByTestId("unallocated")).toHaveText("Unallocated: 0 t -> distributor's choice");
  await fillAddress(ramu);

  // No horizontal scroll at 360px
  expect(await ramu.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await ramu.getByRole("button", { name: "Place order" }).click();
  await expect(ramu).toHaveURL(/\/customer\/orders\/[\w-]+$/);
  await expect(ramu.getByText("Requested", { exact: true })).toBeVisible();
  await expect(ramu.getByText("Anjani Cement")).toBeVisible();
  await expect(ramu.getByText("Ambuja Cement")).toBeVisible();
  await expect(ramu.getByText("10 t", { exact: true })).toBeVisible();
  await expect(ramu.getByText("20 t", { exact: true })).toBeVisible();

  const giri = await login(browser, "giri@example.com", { width: 1280, height: 800 });
  await giri.goto("/distributor/orders");
  await expect(giri.getByText("30 t").first()).toBeVisible();
  await expect(giri.getByText("Ramu Constructions").first()).toBeVisible();
});

test("Ramu orders 15 t with no split, then cancels while requested", async ({ browser }) => {
  const ramu = await login(browser, "ramu@example.com");
  await ramu.goto("/customer/orders/new");
  await ramu.getByLabel("Distributor").selectOption({ label: "Giri Traders" });
  await ramu.getByLabel("Total quantity (tonnes)").fill("15");
  await expect(ramu.getByTestId("unallocated")).toHaveText("Unallocated: 15 t -> distributor's choice");
  await fillAddress(ramu);
  await ramu.getByRole("button", { name: "Place order" }).click();
  await expect(ramu).toHaveURL(/\/customer\/orders\/[\w-]+$/);
  await expect(ramu.getByText("Distributor's choice")).toBeVisible();

  await ramu.getByRole("button", { name: "Cancel order" }).click();
  await ramu.getByRole("button", { name: "Confirm cancel" }).click();
  await expect(ramu.getByText("Cancelled", { exact: true })).toBeVisible();
  await expect(ramu.getByRole("button", { name: "Cancel order" })).toHaveCount(0);
});

test("over-allocation shows a warning and blocks submit", async ({ browser }) => {
  const ramu = await login(browser, "ramu@example.com");
  await ramu.goto("/customer/orders/new");
  await ramu.getByLabel("Distributor").selectOption({ label: "Giri Traders" });
  await ramu.getByLabel("Total quantity (tonnes)").fill("5");
  await ramu.getByRole("button", { name: "Add provider" }).click();
  await ramu.getByLabel("Provider 1", { exact: true }).selectOption({ label: "Anjani Cement" });
  await ramu.getByLabel("Tonnes for provider 1").fill("6");
  await fillAddress(ramu);
  await expect(ramu.getByText("Provider quantities are more than the order total")).toBeVisible();
  await expect(ramu.getByRole("button", { name: "Place order" })).toBeDisabled();
});
