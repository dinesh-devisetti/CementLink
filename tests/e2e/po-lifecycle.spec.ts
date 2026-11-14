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

test("V15: Ambuja rejects -> Giri re-picks Anjani -> accept -> dispatch -> Giri marks delivered; Ramu sees dispatch details", async ({ browser }) => {
  const ramu = await login(browser, "ramu@example.com", { width: 360, height: 740 });
  await ramu.goto("/customer/orders/new");
  await ramu.getByLabel("Distributor").selectOption({ label: "Giri Traders" });
  await ramu.getByLabel("Total quantity (tonnes)").fill("8");
  await ramu.getByRole("button", { name: "Add provider" }).click();
  await ramu.getByLabel("Provider 1", { exact: true }).selectOption({ label: "Ambuja Cement" });
  await ramu.getByLabel("Tonnes for provider 1").fill("8");
  await ramu.getByLabel("Needed by").fill(future());
  await ramu.getByLabel("Delivery address").fill("Plot 77, Lifecycle Lane");
  await ramu.getByLabel("City").fill("Hyderabad");
  await ramu.getByLabel("Pincode").fill("500002");
  await ramu.getByRole("button", { name: "Place order" }).click();
  await expect(ramu).toHaveURL(/\/customer\/orders\/(?!new$)[\w-]+$/);
  const orderId = ramu.url().split("/").pop() as string;

  // Giri opens and places the Ambuja draft.
  const giri = await login(browser, "giri@example.com");
  await giri.goto(`/distributor/orders/${orderId}`);
  await expect(giri.getByRole("heading", { name: "Drafts (1)" })).toBeVisible();
  await giri.getByLabel("Select draft 1").check();
  await giri.getByRole("button", { name: "Place selected (1)" }).click();
  await giri.getByRole("button", { name: "Confirm place" }).click();
  await expect(giri.getByText("POs placed", { exact: true })).toBeVisible();

  // Back navigation: Placed tab -> open PO -> back returns to the Placed tab.
  await giri.goto("/distributor/pos?tab=placed");
  await giri.getByRole("list").getByRole("link").first().click();
  await expect(giri).toHaveURL(/\/distributor\/pos\/[\w-]+\?from=placed$/);
  await giri.getByRole("link", { name: /Placed POs/ }).click();
  await expect(giri).toHaveURL(/\/distributor\/pos\?tab=placed$/);
  await expect(giri.getByRole("link", { name: "Placed", exact: true })).toHaveAttribute("aria-current", "page");

  // Ambuja rejects it.
  const ambuja = await login(browser, "ambuja@example.com");
  await ambuja.goto("/provider/orders");
  await ambuja.getByRole("link", { name: /^8 t - Giri Traders Placed/ }).click();
  await ambuja.getByRole("button", { name: "Reject", exact: true }).click();
  await ambuja.getByLabel("Reason for rejecting").fill("Plant shutdown this week");
  await ambuja.getByRole("button", { name: "Confirm reject" }).click();
  await expect(ambuja.getByText("Reason: Plant shutdown this week")).toBeVisible();
  await expect(ambuja.getByRole("button", { name: "Accept" })).toHaveCount(0);

  // Giri sees the order back under review with a fresh draft, and the reject reason on the rejected PO.
  await giri.goto(`/distributor/orders/${orderId}`);
  await expect(giri.getByText("Under review", { exact: true })).toBeVisible();
  await expect(giri.getByRole("heading", { name: "Drafts (1)" })).toBeVisible();
  await giri.getByLabel("Provider for draft 1").selectOption({ label: "Anjani Cement" });
  await giri.getByLabel("Select draft 1").check();
  await giri.getByRole("button", { name: "Place selected (1)" }).click();
  await giri.getByRole("button", { name: "Confirm place" }).click();
  await expect(giri.getByText("POs placed", { exact: true })).toBeVisible();
  await giri.goto("/distributor/pos?tab=all");
  await giri.getByRole("link", { name: /^8 t - Ambuja Cement Rejected/ }).first().click();
  await expect(giri.getByText("Rejected by provider: Plant shutdown this week")).toBeVisible();

  // Anjani accepts and dispatches.
  const anjani = await login(browser, "anjani@example.com");
  await anjani.goto("/provider/orders");
  await anjani.getByRole("link", { name: /^8 t - Giri Traders Placed/ }).first().click();
  await anjani.getByRole("button", { name: "Accept" }).click();
  await expect(anjani.getByRole("heading", { name: "Dispatch" })).toBeVisible();
  await anjani.getByLabel("Vehicle number (optional)").fill("ts09 ab 4321");
  await anjani.getByLabel("Driver phone (optional)").fill("9876501234");
  await anjani.getByRole("button", { name: "Mark dispatched" }).click();
  await expect(anjani.getByText("Vehicle TS09AB4321")).toBeVisible();

  // Giri marks delivered.
  await giri.goto(`/distributor/orders/${orderId}`);
  await expect(giri.getByText("Dispatched", { exact: true }).first()).toBeVisible();
  await giri.getByRole("button", { name: "Mark delivered" }).click();
  await giri.getByRole("button", { name: "Confirm delivered" }).click();
  await expect(giri.getByText("Delivered", { exact: true })).toBeVisible();

  // Ramu sees the dispatch date and vehicle on his own order, but not the driver phone.
  await ramu.goto(`/customer/orders/${orderId}`);
  await expect(ramu.getByText("Delivered", { exact: true })).toBeVisible();
  await expect(ramu.getByText(/Dispatched \d{4}-\d{2}-\d{2}, vehicle TS09AB4321/)).toBeVisible();
  await expect(ramu.getByText("9876501234")).toHaveCount(0);
});
