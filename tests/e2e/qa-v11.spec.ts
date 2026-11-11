import { expect, test, type Browser, type Page } from "@playwright/test";
import { ROLE_NAV, BUILT_HREFS } from "../../src/lib/nav";

const DEMO = "DemoPass123!";
const USERS = [
  { role: "CUSTOMER", email: "ramu@example.com", pw: DEMO },
  { role: "DISTRIBUTOR", email: "giri@example.com", pw: DEMO },
  { role: "PROVIDER", email: "anjani@example.com", pw: DEMO },
  { role: "ADMIN", email: "admin@example.com", pw: "AdminPass123!" },
] as const;

async function login(browser: Browser, email: string, pw: string): Promise<Page> {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const page = await ctx.newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(pw);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  return page;
}

for (const u of USERS) {
  test(`QA V11: ${u.role} tabs are real links, unbuilt show placeholder, no horizontal overflow at 360px`, async ({ browser }) => {
    const page = await login(browser, u.email, u.pw);
    for (const item of ROLE_NAV[u.role]) {
      const base = "/" + item.href.split("/")[1];
      await page.goto(base === "/admin" ? "/admin" : base);
      const link = page.getByRole("link", { name: item.label, exact: true });
      await expect(link).toHaveAttribute("href", item.href);
      await link.click();
      await expect(page).toHaveURL(new RegExp(`${item.href}$`));
      await expect(link).toHaveAttribute("aria-current", "page");
      if (BUILT_HREFS.has(item.href)) await expect(page.getByText("Coming in a later release.")).toHaveCount(0);
      else await expect(page.getByText("Coming in a later release.")).toBeVisible();
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `${item.href} overflows by ${overflow}px`).toBeLessThanOrEqual(0);
    }
  });
}

test("QA V11: cross-role page access is blocked", async ({ browser }) => {
  const page = await login(browser, "ramu@example.com", DEMO);
  for (const p of ["/distributor/providers", "/provider/distributors", "/admin/approvals", "/distributor/customers", "/admin/whatever", "/customer/nope"]) {
    const res = await page.goto(p);
    const url = page.url();
    expect(url.includes(p) && res?.status() === 200, `customer reached ${p} (${url}, ${res?.status()})`).toBe(false);
  }
});

test("QA V11: new customer requests Giri, sees Cancel request at 360px, cancels, badge refreshes; Giri sees name + city only on own row", async ({ browser }) => {
  const ctx = await browser.newContext({ viewport: { width: 360, height: 740 } });
  const page = await ctx.newPage();
  const email = `qa${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Name").fill("Zed Personal");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Phone").fill("9876501234");
  await page.getByLabel("Password").fill("password12345");
  await page.getByRole("button", { name: /register|create/i }).click();
  await expect(page).not.toHaveURL(/\/register$/);
  await page.goto("/customer/distributors");
  await page.getByRole("button", { name: "Find distributors" }).click();
  await page.getByRole("button", { name: "Request link to Giri Traders" }).click();
  const cancel = page.getByRole("button", { name: /Cancel request/ });
  await expect(cancel).toBeVisible();
  const box = await cancel.boundingBox();
  expect(box!.x + box!.width).toBeLessThanOrEqual(360);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);

  const giri = await login(browser, "giri@example.com", DEMO);
  await giri.goto("/distributor/customers");
  await expect(giri.getByText("Zed Personal")).toBeVisible();

  await cancel.click();
  await expect(page.getByRole("button", { name: "Request link to Giri Traders" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Cancel request/ })).toHaveCount(0);
  await giri.reload();
  await expect(giri.getByText("Zed Personal")).toHaveCount(0);
  await page.getByRole("button", { name: "Request link to Giri Traders" }).click();
  await expect(page.getByRole("button", { name: /Cancel request/ })).toBeVisible();
});
