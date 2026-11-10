import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 360, height: 740 } });

const PW = "password123";
const stamp = Date.now() + 1;

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
async function registerDistributor(page: Page, email: string, business: string) {
  await page.goto("/register");
  await page.getByLabel("Distributor").check();
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

test("distributor accepts and rejects lines; customer sees updated status", async ({ page }) => {
  const dist = `Acme${stamp}`;
  const other = `Other${stamp}`;
  await registerDistributor(page, `a-${stamp}@example.com`, dist);
  await registerDistributor(page, `o-${stamp}@example.com`, other);
  await login(page, "admin@example.com", "AdminPass123!");
  for (const name of [dist, other]) {
    await page.getByRole("button", { name: `Approve ${name}` }).click();
    await expect(page.getByRole("button", { name: `Approve ${name}` })).toHaveCount(0);
  }
  await logout(page);

  const custEmail = `cl-${stamp}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Name", { exact: true }).fill("Ravi");
  await page.getByLabel("Email").fill(custEmail);
  await page.getByLabel("Password").fill(PW);
  await page.getByLabel("Phone").fill("9876543211");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/customer$/);
  await page.getByRole("link", { name: "+ New request" }).click();
  await page.getByLabel("Quantity").fill("50");
  await page.getByLabel("Address").fill("12 MG Road");
  await page.getByLabel("City", { exact: true }).fill("Pune");
  await page.getByLabel("Pincode").fill("411001");
  await page.getByLabel("Needed by").fill(new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10));
  await page.getByLabel(dist).check();
  await page.getByLabel(`Bags for ${dist}`).fill("30");
  await page.getByLabel(other).check();
  await page.getByLabel(`Bags for ${other}`).fill("20");
  await page.getByRole("button", { name: "Send request" }).click();
  await expect(page).toHaveURL(/\/customer$/);
  await logout(page);

  await login(page, `a-${stamp}@example.com`, PW);
  await expect(page).toHaveURL(/\/distributor$/);
  const cards = page.getByTestId("line-card");
  await expect(cards).toHaveCount(1); // only own line
  await expect(cards.first()).toContainText("30 bags");
  await expect(page.getByText("12 MG Road")).toHaveCount(0);
  await page.getByRole("button", { name: "Accept Ravi" }).click();
  await page.getByLabel("Price per bag").fill("300");
  await expect(page.getByText("30 x ₹300.00 = ₹9,000.00")).toBeVisible();
  await page.getByRole("button", { name: "Confirm" }).click();
  await expect(page.getByText("Total ₹9,000.00")).toBeVisible();
  await expect(page.getByTestId("accepted-demand")).toHaveText("30 bags (1.5 t)");
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await logout(page);

  await login(page, `o-${stamp}@example.com`, PW);
  await page.getByRole("button", { name: "Reject Ravi" }).click();
  await page.getByRole("button", { name: "Confirm reject Ravi" }).click();
  await expect(page.getByText("Rejected")).toBeVisible();
  await logout(page);

  await login(page, custEmail, PW);
  const card = page.getByTestId("request-card").first();
  await expect(card.getByText("Accepted")).toBeVisible();
  await expect(card.getByText("Rejected")).toBeVisible();
});
