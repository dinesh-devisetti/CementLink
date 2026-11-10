import { expect, test, type Page } from "@playwright/test";

test.use({ viewport: { width: 360, height: 740 } });

const PW = "password123";
const stamp = Date.now();

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
async function registerCustomer(page: Page, email: string) {
  await page.goto("/register");
  await page.getByLabel("Name", { exact: true }).fill("Ravi");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PW);
  await page.getByLabel("Phone").fill("9876543211");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/customer$/);
}
const noHScroll = async (page: Page) =>
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

test("customer splits a request across two ACTIVE distributors at 360px", async ({ page }) => {
  const sharma = `Sharma${stamp}`;
  const gupta = `Gupta${stamp}`;
  const waiting = `Waiting${stamp}`;
  await registerDistributor(page, `s-${stamp}@example.com`, sharma);
  await registerDistributor(page, `g-${stamp}@example.com`, gupta);
  await registerDistributor(page, `w-${stamp}@example.com`, waiting);
  await login(page, "admin@example.com", "AdminPass123!");
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole("button", { name: `Approve ${sharma}` }).click();
  await expect(page.getByRole("button", { name: `Approve ${sharma}` })).toHaveCount(0);
  await page.getByRole("button", { name: `Approve ${gupta}` }).click();
  await expect(page.getByRole("button", { name: `Approve ${gupta}` })).toHaveCount(0);
  await logout(page);

  const custEmail = `c-${stamp}@example.com`;
  await registerCustomer(page, custEmail);
  await expect(page.getByText("No requests yet")).toBeVisible();
  await page.getByRole("link", { name: "+ New request" }).click();
  await expect(page).toHaveURL(/\/customer\/new$/);
  await noHScroll(page);

  // only ACTIVE distributors are offered
  await expect(page.getByLabel(sharma)).toBeVisible();
  await expect(page.getByLabel(gupta)).toBeVisible();
  await expect(page.getByText(waiting)).toHaveCount(0);

  // tonnes -> bags, whole bags only
  await page.getByLabel("Tonnes").check();
  await page.getByLabel("Quantity").fill("2.5");
  await expect(page.getByTestId("qty-summary")).toHaveText("= 2.5 t / 50 bags");
  await page.getByLabel("Quantity").fill("0.03");
  await expect(page.getByText("Must be a whole number of bags")).toBeVisible();
  await page.getByLabel("Quantity").fill("2.5");

  await page.getByLabel("Address").fill("12 MG Road");
  await page.getByLabel("City", { exact: true }).fill("Pune");
  await page.getByLabel("Pincode").fill("411001");
  await page.getByLabel("Needed by").fill("2020-01-01");

  const send = page.getByRole("button", { name: "Send request" });
  await expect(send).toBeDisabled();
  await page.getByLabel(sharma).check();
  await page.getByLabel(`Bags for ${sharma}`).fill("30");
  await expect(page.getByTestId("remaining")).toHaveText("Remaining: 20 bags");
  await expect(send).toBeDisabled();
  await page.getByLabel(gupta).check();
  await page.getByLabel(`Bags for ${gupta}`).fill("25");
  await expect(page.getByTestId("remaining")).toHaveText("Remaining: -5 bags");
  await expect(send).toBeDisabled();
  await page.getByLabel(`Bags for ${gupta}`).fill("20");
  await expect(page.getByTestId("remaining")).toHaveText("All bags allocated");
  await expect(send).toBeEnabled();
  await noHScroll(page);

  // past date is rejected by the server
  await send.click();
  await expect(page.getByText("Pick today or a later date")).toBeVisible();
  await expect(page).toHaveURL(/\/customer\/new$/);

  const future = new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10);
  await page.getByLabel("Needed by").fill(future);
  await send.click();
  await expect(page).toHaveURL(/\/customer$/);

  const card = page.getByTestId("request-card").first();
  await expect(card).toContainText("50 bags (2.5 t)");
  await expect(card).toContainText(sharma);
  await expect(card).toContainText(gupta);
  await expect(card.getByText("Sent")).toHaveCount(2);
  await noHScroll(page);

  await card.getByRole("link", { name: "Details" }).click();
  await expect(page.getByRole("heading", { name: "Request details" })).toBeVisible();
  await expect(page.getByText("30 bags")).toBeVisible();
  const detailUrl = page.url();

  // isolation: another customer cannot open this request
  await page.goto("/customer");
  await logout(page);
  await registerCustomer(page, `c2-${stamp}@example.com`);
  const res = await page.goto(detailUrl);
  expect(res?.status()).toBe(404);
  await expect(page.getByText("12 MG Road")).toHaveCount(0);
});
