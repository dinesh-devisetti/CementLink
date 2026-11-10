import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 360, height: 740 } });

const PW = "password123";
const stamp = Date.now() + 2;

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

test("distributor places POs; provider confirms/rejects; over-order warning", async ({ page }) => {
  const dist = `PoDist${stamp}`;
  const prov = `PoProv${stamp}`;
  await register(page, "Distributor", `pd-${stamp}@example.com`, dist);
  await register(page, "Provider", `pp-${stamp}@example.com`, prov);
  await login(page, "admin@example.com", "AdminPass123!");
  for (const name of [dist, prov]) {
    await page.getByRole("button", { name: `Approve ${name}` }).click();
    await expect(page.getByRole("button", { name: `Approve ${name}` })).toHaveCount(0);
  }
  await logout(page);

  await login(page, `pd-${stamp}@example.com`, PW);
  await expect(page).toHaveURL(/\/distributor$/);
  await page.getByRole("link", { name: "Purchase orders" }).click();
  await expect(page.getByText("No purchase orders")).toBeVisible();
  for (const [qty, rate] of [["40", "300"], ["10", "250.50"]]) {
    await page.getByRole("button", { name: "+ New PO" }).click();
    await page.getByLabel("Provider").selectOption({ label: `${prov} (Pune)` });
    await page.getByLabel("Quantity (bags)").fill(qty);
    await page.getByLabel("Rate per bag").fill(rate);
    if (qty === "40") {
      await expect(page.getByText("40 x ₹300.00 = ₹12,000.00")).toBeVisible();
      await expect(page.getByText("40 bags more than unfulfilled demand")).toBeVisible();
    }
    await page.getByRole("button", { name: "Place order" }).click();
    await expect(page.getByRole("button", { name: "+ New PO" })).toBeVisible();
  }
  await expect(page.getByTestId("po-card")).toHaveCount(2);
  await expect(page.getByTestId("po-card").first()).toContainText("₹2,505.00");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await logout(page);

  await login(page, `pp-${stamp}@example.com`, PW);
  await expect(page).toHaveURL(/\/provider$/);
  await expect(page.getByTestId("orders-received")).toHaveText("2");
  const cards = page.getByTestId("po-card");
  await expect(cards).toHaveCount(2);
  await expect(cards.first()).toContainText(dist);
  await page.getByRole("button", { name: `Confirm order from ${dist}` }).first().click();
  await expect(page.getByText("Confirmed")).toBeVisible();
  await page.getByRole("button", { name: `Reject order from ${dist}` }).click();
  await expect(page.getByText("Reject this order?")).toBeVisible();
  await page.getByRole("button", { name: `Confirm reject order from ${dist}` }).click();
  await expect(page.getByText("Rejected")).toBeVisible();
  await logout(page);

  await login(page, `pd-${stamp}@example.com`, PW);
  await expect(page).toHaveURL(/\/distributor$/);
  await page.goto("/distributor/orders");
  await expect(page.getByText("Confirmed")).toBeVisible();
  await expect(page.getByText("Rejected")).toBeVisible();
});
