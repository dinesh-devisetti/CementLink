import { expect, test } from "@playwright/test";

test("QA V12: order pages have no horizontal overflow at 360px; customer cannot open another role's orders page", async ({ browser }) => {
  const page = await (await browser.newContext({ viewport: { width: 360, height: 740 } })).newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill("ramu@example.com");
  await page.getByLabel("Password").fill("DemoPass123!");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  for (const path of ["/customer/orders", "/customer/orders/new"]) {
    await page.goto(path);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), path).toBe(true);
  }
  await page.goto("/distributor/orders");
  await expect(page).not.toHaveURL(/\/distributor\/orders$/);
  const res = await page.request.get("/api/orders/does-not-exist");
  expect(res.status()).toBe(404);
});
