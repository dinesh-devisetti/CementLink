import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 360, height: 740 } });

const PW = "password123";
const stamp = Date.now() + 3;

async function logout(page: Page) {
  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);
}
async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
}
async function register(page: Page, role: "Distributor" | "Provider", email: string, business: string) {
  await page.goto("/register");
  await page.getByLabel(role).check();
  await page.getByLabel("Name", { exact: true }).fill(business);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PW);
  await page.getByLabel("Phone").fill("9876543210");
  await page.getByLabel("Business name").fill(business);
  await page.getByLabel("City").fill("Pune");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/pending$/);
  await logout(page);
}

test("provider invoices a confirmed PO; cap and duplicate enforced; distributor sees it read-only", async ({ page }) => {
  const dist = `InvDist${stamp}`;
  const prov = `InvProv${stamp}`;
  await register(page, "Distributor", `id-${stamp}@example.com`, dist);
  await register(page, "Provider", `ip-${stamp}@example.com`, prov);
  await login(page, "admin@example.com", "AdminPass123!");
  for (const name of [dist, prov]) {
    await page.getByRole("button", { name: `Approve ${name}` }).click();
    await expect(page.getByRole("button", { name: `Approve ${name}` })).toHaveCount(0);
  }
  await logout(page);

  await login(page, `id-${stamp}@example.com`, PW);
  await expect(page).toHaveURL(/\/distributor$/);
  await page.goto("/distributor/orders");
  await page.getByRole("button", { name: "+ New PO" }).click();
  await page.getByLabel("Provider").selectOption({ label: `${prov} (Pune)` });
  await page.getByLabel("Quantity (bags)").fill("100");
  await page.getByLabel("Rate per bag").fill("300");
  await page.getByRole("button", { name: "Place order" }).click();
  await expect(page.getByTestId("po-card")).toHaveCount(1);
  await logout(page);

  await login(page, `ip-${stamp}@example.com`, PW);
  await expect(page).toHaveURL(/\/provider$/);
  await expect(page.getByTestId("bags-sold")).toHaveText("0");
  await page.getByRole("button", { name: `Confirm order from ${dist}` }).click();
  await page.getByRole("link", { name: `Add invoice for order from ${dist}` }).click();
  await expect(page.getByText("Internal record, not a GST invoice.")).toBeVisible();

  await page.getByLabel("Invoice no.").fill("inv-1");
  await page.getByLabel("Qty supplied (bags)").fill("101");
  await expect(page.getByText("Max 100 bags").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Save invoice" })).toBeDisabled();
  await page.getByLabel("Qty supplied (bags)").fill("60");
  await expect(page.getByText("60 x ₹300.00 = ₹18,000.00")).toBeVisible();
  await page.getByRole("button", { name: "Save invoice" }).click();
  await expect(page.getByTestId("invoice-row")).toHaveCount(1);
  await expect(page.getByTestId("invoice-row")).toContainText("INV-1");

  await page.getByLabel("Invoice no.").fill("INV-1");
  await page.getByLabel("Qty supplied (bags)").fill("10");
  await page.getByRole("button", { name: "Save invoice" }).click();
  await expect(page.getByText("Invoice number already used")).toBeVisible();
  await page.getByLabel("Invoice no.").fill("INV-2");
  await page.getByLabel("Qty supplied (bags)").fill("40");
  await page.getByRole("button", { name: "Save invoice" }).click();
  await expect(page.getByTestId("invoice-row")).toHaveCount(2);
  await expect(page.getByText("This order is fully invoiced.")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.goto("/provider");
  await expect(page.getByTestId("bags-sold")).toHaveText("100");
  await expect(page.getByTestId("invoiced-total")).toHaveText("₹30,000.00");
  await page.getByRole("link", { name: "By distributor" }).click();
  await expect(page.getByTestId("dist-total")).toContainText(`${dist}`);
  await expect(page.getByTestId("dist-total")).toContainText("100 bags · ₹30,000.00 · 2 invoices");
  await page.getByRole("link", { name: "Invoices" }).click();
  await expect(page.getByTestId("invoice-row")).toHaveCount(2);
  await logout(page);

  await login(page, `id-${stamp}@example.com`, PW);
  await expect(page).toHaveURL(/\/distributor$/);
  await page.goto("/distributor/orders");
  await page.getByText("Invoices (2)").click();
  await expect(page.getByTestId("invoice-row")).toHaveCount(2);
  await expect(page.getByRole("button", { name: "Save invoice" })).toHaveCount(0);
});
