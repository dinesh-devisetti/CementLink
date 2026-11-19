import { expect, test, type Page } from "@playwright/test";

async function adminPage(browser: import("@playwright/test").Browser): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill("admin@example.com");
  await page.getByLabel("Password").fill("AdminPass123!");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  return page;
}

test("V21: distributor search via the filter form and URL", async ({ browser }) => {
  const admin = await adminPage(browser);
  await admin.goto("/admin/distributors");
  await expect(admin.getByTestId("distributor-row").first()).toBeVisible();
  await admin.getByLabel(/Search distributors/).fill("  giri  ");
  await admin.getByRole("button", { name: "Apply" }).click();
  await expect(admin).toHaveURL(/q=.*giri/);
  const rows = admin.getByTestId("distributor-row");
  await expect(rows).toHaveCount(1);
  await expect(rows.first()).toHaveAttribute("data-distributor", "Giri Traders");
  await admin.getByRole("link", { name: "Clear" }).click();
  await expect(admin).toHaveURL(/\/admin\/distributors$/);
});

test("V21: date range empties transport; bad params never 500", async ({ browser }) => {
  const admin = await adminPage(browser);
  await admin.goto("/admin/transport?from=2999-01-01&to=2999-12-31");
  await expect(admin.getByText("No dispatches match.")).toBeVisible();
  await expect(admin.getByLabel("From (IST)")).toHaveValue("2999-01-01");
  for (const path of [
    "/admin/transport?from=garbage&to=2026-02-30",
    "/admin/transport?from=2026-03-02&to=2026-03-01&q=%00%27%3B--",
    "/admin/customers?q=%25%5C_&page=abc",
    "/admin/distributors?from=2026-1-1&q=" + "z".repeat(3000),
  ]) {
    const res = await admin.goto(path);
    expect(res?.status(), path).toBe(200);
  }
  await admin.goto("/admin/customers?q=ramu");
  await expect(admin.getByTestId("customer-row")).toHaveCount(1);
  const api = await admin.request.get("/api/admin/dispatches?from=2026-03-02&to=2026-03-01");
  expect(api.status()).toBe(200);
});

test("V21: filters stay admin-only", async ({ page }) => {
  const res = await page.request.get("/api/admin/customers?q=ramu", { maxRedirects: 0 });
  expect(res.status()).toBe(401);
});
