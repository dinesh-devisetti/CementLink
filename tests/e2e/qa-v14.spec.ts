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

test("QA V14: drafts of different providers cannot be combined (UI blocks with reason)", async ({ browser }) => {
  const a = await ramuOrders(browser, "3", [["Ambuja Cement", "3"]]);
  const b = await ramuOrders(browser, "2", [["Anjani Cement", "2"]]);
  const giri = await login(browser, "giri@example.com");
  for (const o of [a, b]) {
    await giri.goto(`/distributor/orders/${o}`);
    await expect(giri.getByRole("heading", { name: "Drafts (1)" })).toBeVisible();
  }
  await giri.goto("/distributor/pos?tab=drafts");
  const cards = giri.locator('section[aria-label="Drafts"] > ul > li');
  const cardOf = (id: string) => cards.filter({ has: giri.getByRole("link", { name: `Order #${id.slice(-4)}` }) });
  await cardOf(a).getByRole("checkbox", { name: /^Select draft/ }).check();
  await cardOf(b).getByRole("checkbox", { name: /^Select draft/ }).check();
  await expect(giri.getByRole("button", { name: "Combine selected (2)" })).toBeDisabled();
  await expect(giri.getByText("Combine: Select drafts of the same provider.")).toBeVisible();
});
