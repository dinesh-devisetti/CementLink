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

test("V14: combine two Ambuja drafts from two Ramu orders -> place -> Ambuja sees one PO with 2 orders; split back is offered while draft", async ({ browser }) => {
  const a = await ramuOrders(browser, "3.125", [["Ambuja Cement", "3.125"]]);
  const b = await ramuOrders(browser, "2.5", [["Ambuja Cement", "2.5"]]);

  const giri = await login(browser, "giri@example.com");
  await giri.goto(`/distributor/orders/${a}`);
  await expect(giri.getByRole("heading", { name: "Drafts (1)" })).toBeVisible();
  await giri.goto(`/distributor/orders/${b}`);
  await expect(giri.getByRole("heading", { name: "Drafts (1)" })).toBeVisible();

  await giri.goto("/distributor/pos?tab=drafts");
  const cards = giri.locator('section[aria-label="Drafts"] > ul > li');
  const cardOf = (id: string) => cards.filter({ has: giri.getByRole("link", { name: `Order #${id.slice(-4)}` }) });
  await cardOf(a).getByRole("checkbox", { name: /^Select draft/ }).check();
  await expect(giri.getByRole("button", { name: /^Combine selected/ })).toBeDisabled();
  await expect(giri.getByText("Combine: Select at least two drafts to combine.")).toBeVisible();
  await cardOf(b).getByRole("checkbox", { name: /^Select draft/ }).check();
  await expect(giri.getByRole("button", { name: "Combine selected (2)" })).toBeEnabled();
  await giri.getByRole("button", { name: "Combine selected (2)" }).click();

  const combined = cardOf(a);
  await expect(combined).toHaveCount(1);
  await expect(combined.getByRole("link", { name: `Order #${b.slice(-4)}` })).toBeVisible();
  await expect(combined.getByRole("button", { name: /^Split back draft/ })).toBeVisible();
  await combined.getByRole("checkbox", { name: /^Select draft/ }).check();
  await giri.getByRole("button", { name: "Place selected (1)" }).click();
  await giri.getByRole("button", { name: "Confirm place" }).click();
  await expect(cardOf(a)).toHaveCount(0);

  const ambuja = await login(browser, "ambuja@example.com");
  await ambuja.goto("/provider/orders");
  const card = ambuja.getByRole("link", { name: /^5\.625 t - Giri Traders Placed/ });
  await expect(card).toHaveCount(1);
  await expect(card).toContainText("2 orders");
});

test("V14: split back moves one order out of a combined draft into a new draft; at least one must stay", async ({ browser }) => {
  const a = await ramuOrders(browser, "1.125", [["Ambuja Cement", "1.125"]]);
  const b = await ramuOrders(browser, "1.5", [["Ambuja Cement", "1.5"]]);
  const giri = await login(browser, "giri@example.com");
  for (const id of [a, b]) {
    await giri.goto(`/distributor/orders/${id}`);
    await expect(giri.getByRole("heading", { name: "Drafts (1)" })).toBeVisible();
  }
  await giri.goto("/distributor/pos?tab=drafts");
  const cards = giri.locator('section[aria-label="Drafts"] > ul > li');
  const cardOf = (id: string) => cards.filter({ has: giri.getByRole("link", { name: `Order #${id.slice(-4)}` }) });
  await cardOf(a).getByRole("checkbox", { name: /^Select draft/ }).check();
  await cardOf(b).getByRole("checkbox", { name: /^Select draft/ }).check();
  await giri.getByRole("button", { name: "Combine selected (2)" }).click();

  const combined = cardOf(a);
  await expect(combined.getByRole("link", { name: `Order #${b.slice(-4)}` })).toBeVisible();
  await combined.getByRole("button", { name: /^Split back draft/ }).click();
  const group = combined.getByRole("group", { name: /^Split back draft/ });
  await expect(group.getByRole("button", { name: "Split back selected" })).toBeDisabled();
  await group.getByLabel(new RegExp(`Move order #${b.slice(-4)}`)).check();
  await group.getByLabel(new RegExp(`Move order #${a.slice(-4)}`)).check();
  await expect(group.getByText("At least one order must stay in the draft.")).toBeVisible();
  await group.getByLabel(new RegExp(`Move order #${a.slice(-4)}`)).uncheck();
  await group.getByRole("button", { name: "Split back selected" }).click();

  await expect(cardOf(b)).toHaveCount(1);
  await expect(cardOf(a)).toHaveCount(1);
  await expect(cardOf(a).getByRole("link", { name: `Order #${b.slice(-4)}` })).toHaveCount(0);
  await expect(cardOf(b).getByRole("link", { name: `Order #${a.slice(-4)}` })).toHaveCount(0);
});
