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

test("V16: Anjani invoices a dispatched PO in two parts -> PO Invoiced; Giri sees both read-only", async ({ browser }) => {
  const ramu = await login(browser, "ramu@example.com", { width: 360, height: 740 });
  await ramu.goto("/customer/orders/new");
  await ramu.getByLabel("Distributor").selectOption({ label: "Giri Traders" });
  await ramu.getByLabel("Total quantity (tonnes)").fill("10");
  await ramu.getByRole("button", { name: "Add provider" }).click();
  await ramu.getByLabel("Provider 1", { exact: true }).selectOption({ label: "Anjani Cement" });
  await ramu.getByLabel("Tonnes for provider 1").fill("10");
  await ramu.getByLabel("Needed by").fill(future());
  await ramu.getByLabel("Delivery address").fill("Plot 88, Invoice Lane");
  await ramu.getByLabel("City").fill("Hyderabad");
  await ramu.getByLabel("Pincode").fill("500003");
  await ramu.getByRole("button", { name: "Place order" }).click();
  await expect(ramu).toHaveURL(/\/customer\/orders\/(?!new$)[\w-]+$/);
  const orderId = ramu.url().split("/").pop() as string;

  const giri = await login(browser, "giri@example.com");
  await giri.goto(`/distributor/orders/${orderId}`);
  await giri.getByLabel("Select draft 1").check();
  await giri.getByRole("button", { name: "Place selected (1)" }).click();
  await giri.getByRole("button", { name: "Confirm place" }).click();
  await expect(giri.getByText("POs placed", { exact: true })).toBeVisible();

  const anjani = await login(browser, "anjani@example.com", { width: 360, height: 740 });
  await anjani.goto("/provider/orders");
  await anjani.getByRole("link", { name: /^10 t - Giri Traders Placed/ }).first().click();
  await expect(anjani).toHaveURL(/\/provider\/orders\/[\w-]+$/);
  const poUrl = anjani.url();
  await anjani.getByRole("button", { name: "Accept" }).click();
  await anjani.getByRole("button", { name: "Mark dispatched" }).click();
  await expect(anjani.getByRole("heading", { name: "New invoice" })).toBeVisible();

  const stamp = Date.now();
  await anjani.getByLabel("Invoice no.").fill(`e16-${stamp}-a`);
  await anjani.getByLabel("Quantity (tonnes)").fill("10.5");
  await expect(anjani.getByText("Max 10 t")).toBeVisible();
  await expect(anjani.getByRole("button", { name: "Save invoice" })).toBeDisabled();
  await anjani.getByLabel("Quantity (tonnes)").fill("4");
  await anjani.getByLabel("Rate per tonne (Rs)").fill("5400");
  await expect(anjani.getByText(/4 t x .*5,400\.00 = .*21,600\.00/)).toBeVisible();
  await anjani.getByRole("button", { name: "Save invoice" }).click();
  await expect(anjani.getByTestId("invoice-row")).toHaveCount(1);
  await expect(anjani.getByText("Remaining 6 t of 10 t")).toBeVisible();

  await anjani.getByLabel("Invoice no.").fill(`E16-${stamp}-A`);
  await anjani.getByLabel("Quantity (tonnes)").fill("1");
  await anjani.getByRole("button", { name: "Save invoice" }).click();
  await expect(anjani.getByText("Invoice number already used")).toBeVisible();

  await anjani.getByLabel("Invoice no.").fill(`E16-${stamp}-B`);
  await anjani.getByLabel("Quantity (tonnes)").fill("6");
  await anjani.getByRole("button", { name: "Save invoice" }).click();
  await expect(anjani.getByTestId("invoice-row")).toHaveCount(2);
  await expect(anjani.getByText("Invoiced", { exact: true })).toBeVisible();
  await expect(anjani.getByRole("button", { name: "Save invoice" })).toHaveCount(0);
  expect(await anjani.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await anjani.goto("/provider/invoices");
  await expect(anjani.getByTestId("invoice-row").filter({ hasText: `E16-${stamp}-B` })).toBeVisible();
  await anjani.goto(poUrl);
  await expect(anjani.getByRole("heading", { name: "Invoices (2)" })).toBeVisible();

  await giri.goto("/distributor/invoices-in");
  await expect(giri.getByTestId("invoice-row").filter({ hasText: `E16-${stamp}-A` })).toContainText("Anjani Cement");
  await expect(giri.getByRole("button", { name: "Save invoice" })).toHaveCount(0);
  await giri.goto(poUrl.replace("/provider/orders/", "/distributor/pos/"));
  await expect(giri.getByRole("heading", { name: "Provider invoices (2)" })).toBeVisible();
  await expect(giri.getByRole("button", { name: "Save invoice" })).toHaveCount(0);
});
