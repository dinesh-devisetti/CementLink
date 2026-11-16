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


test("V17: Giri records a part then the full payment -> Anjani sees receipts, invoice paid, PO Paid", async ({ browser }) => {
  const ramu = await login(browser, "ramu@example.com", { width: 360, height: 740 });
  await ramu.goto("/customer/orders/new");
  await ramu.getByLabel("Distributor").selectOption({ label: "Giri Traders" });
  await ramu.getByLabel("Total quantity (tonnes)").fill("10");
  await ramu.getByRole("button", { name: "Add provider" }).click();
  await ramu.getByLabel("Provider 1", { exact: true }).selectOption({ label: "Anjani Cement" });
  await ramu.getByLabel("Tonnes for provider 1").fill("10");
  await ramu.getByLabel("Needed by").fill(future());
  await ramu.getByLabel("Delivery address").fill("Plot 17, Payment Lane");
  await ramu.getByLabel("City").fill("Hyderabad");
  await ramu.getByLabel("Pincode").fill("500004");
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
  await anjani.getByRole("link", { name: /^10 t - Giri Traders Placed/ }).first().click();
  const poUrl = anjani.url();
  await anjani.getByRole("button", { name: "Accept" }).click();
  await anjani.getByRole("button", { name: "Mark dispatched" }).click();
  const no = `E17-${Date.now()}`;
  await anjani.getByLabel("Invoice no.").fill(no);
  await anjani.getByLabel("Quantity (tonnes)").fill("10");
  await anjani.getByLabel("Rate per tonne (Rs)").fill("5400");
  await anjani.getByRole("button", { name: "Save invoice" }).click();
  await expect(anjani.getByTestId("invoice-row")).toHaveCount(1);

  // Giri pays part, then the rest (Rs 54,000.00 in total).
  await giri.goto("/distributor/payments");
  const form = giri.getByRole("form", { name: `Record payment for ${no}` });
  await form.getByLabel("Amount (Rs)").fill("54000.01");
  await expect(form.getByText("Max")).toBeVisible();
  await expect(form.getByRole("button", { name: "Record payment" })).toBeDisabled();
  await form.getByLabel("Amount (Rs)").fill("20000");
  await form.getByLabel("Mode").selectOption("NEFT");
  await form.getByLabel("Reference (optional)").fill("UTR-17A");
  await form.getByRole("button", { name: "Record payment" }).click();
  const row = giri.getByTestId("payable-row").filter({ hasText: no });
  await expect(row).toContainText("Outstanding");
  await expect(row).toContainText("34,000.00");
  await giri.getByRole("form", { name: `Record payment for ${no}` }).getByLabel("Amount (Rs)").fill("34000");
  await giri.getByRole("form", { name: `Record payment for ${no}` }).getByRole("button", { name: "Record payment" }).click();
  await expect(giri.getByTestId("payable-row").filter({ hasText: no })).toHaveCount(0);
  await expect(giri.getByTestId("receipt-row").filter({ hasText: no })).toHaveCount(2);

  // Anjani: receipts, read-only, outstanding 0 for the invoice, PO Paid.
  await anjani.goto("/provider/payments");
  await expect(anjani.getByTestId("receipt-row").filter({ hasText: no })).toHaveCount(2);
  await expect(anjani.getByTestId("receipt-row").filter({ hasText: "UTR-17A" })).toContainText("20,000.00");
  await expect(anjani.getByRole("button", { name: "Record payment" })).toHaveCount(0);
  await anjani.getByRole("link", { name: "Giri Traders" }).first().click();
  await expect(anjani.getByTestId("payable-row").filter({ hasText: no })).toContainText("Paid in full");
  await anjani.goto(poUrl);
  await expect(anjani.getByText("Paid", { exact: true }).first()).toBeVisible();
});
