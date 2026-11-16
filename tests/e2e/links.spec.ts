import { expect, test, type Browser, type Page } from "@playwright/test";

const DEMO = "DemoPass123!";

async function login(browser: Browser, email: string, password = DEMO): Promise<Page> {
  const page = await (await browser.newContext()).newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  return page;
}

test("Giri requests Anjani -> Anjani approves; tabs are links with aria-current", async ({ browser }) => {
  const giri = await login(browser, "giri@example.com");
  await giri.goto("/distributor/providers");
  await expect(giri.getByRole("link", { name: "Providers", exact: true })).toHaveAttribute("aria-current", "page");
  const linked = giri.getByRole("region", { name: "Linked" });
  await expect(linked.getByText("Anjani Cement")).toBeVisible();

  // Revoke the seeded link, then go through the real request flow.
  await giri.getByRole("button", { name: "Revoke Anjani Cement" }).click();
  await giri.getByRole("button", { name: "Confirm revoke" }).click();
  await expect(linked.getByText("Anjani Cement")).toHaveCount(0);

  await giri.getByRole("button", { name: "Find providers" }).click();
  await giri.getByRole("button", { name: "Request link to Anjani Cement" }).click();
  await expect(giri.getByRole("region", { name: "Requests and history" }).getByText("Pending - you requested")).toBeVisible();

  // Withdraw the request, then ask again straight away (cancel has no cooldown).
  await giri.getByRole("button", { name: "Cancel request to Anjani Cement" }).click();
  await expect(giri.getByRole("button", { name: "Cancel request to Anjani Cement" })).toHaveCount(0);
  await giri.getByRole("button", { name: "Request again" }).or(giri.getByRole("button", { name: "Request link to Anjani Cement" })).first().click();
  await expect(giri.getByRole("button", { name: "Cancel request to Anjani Cement" })).toBeVisible();

  const anjani = await login(browser, "anjani@example.com");
  await anjani.goto("/provider/distributors");
  const requests = anjani.getByRole("region", { name: "Requests to you" });
  await expect(requests.getByText("Giri Traders")).toBeVisible();
  await anjani.getByRole("button", { name: "Approve Giri Traders" }).click();
  await expect(anjani.getByRole("region", { name: "Linked" }).getByText("Giri Traders")).toBeVisible();
  await expect(anjani.getByRole("region", { name: "Linked" }).getByText("Active")).toBeVisible();

  await giri.reload();
  await expect(giri.getByRole("region", { name: "Linked" }).getByText("Anjani Cement")).toBeVisible();

  // Tabs are real links; the current one carries aria-current.
  await giri.getByRole("link", { name: "Invoices out" }).click();
  await expect(giri).toHaveURL(/\/distributor\/invoices-out$/);
  await expect(giri.getByRole("heading", { name: "Invoices out" })).toBeVisible();
  await expect(giri.getByRole("link", { name: "Invoices out" })).toHaveAttribute("aria-current", "page");
  await expect(giri.getByRole("link", { name: "Providers", exact: true })).not.toHaveAttribute("aria-current", "page");
});

test("Ramu requests Giri -> Giri approves", async ({ browser }) => {
  const ramu = await login(browser, "ramu@example.com");
  await ramu.goto("/customer/distributors");
  await expect(ramu.getByRole("region", { name: "Linked" }).getByText("Giri Traders")).toBeVisible();
  await ramu.getByRole("button", { name: "Revoke Giri Traders" }).click();
  await ramu.getByRole("button", { name: "Confirm revoke" }).click();
  await expect(ramu.getByText("No links yet. Find a distributor.")).toBeVisible();

  await ramu.getByRole("button", { name: "Find distributors" }).click();
  await ramu.getByRole("button", { name: "Request link to Giri Traders" }).click();
  await expect(ramu.getByRole("region", { name: "Requests and history" }).getByText("Pending - you requested")).toBeVisible();

  const giri = await login(browser, "giri@example.com");
  await giri.goto("/distributor/customers");
  await giri.getByRole("button", { name: "Approve Ramu Constructions" }).click();
  await expect(giri.getByRole("region", { name: "Linked" }).getByText("Ramu Constructions")).toBeVisible();

  await ramu.reload();
  await expect(ramu.getByRole("region", { name: "Linked" }).getByText("Giri Traders")).toBeVisible();
});

test("admin revokes an approved account and force-links parties", async ({ browser }) => {
  const stamp = Date.now();
  const name = `Zed${stamp}`;
  const email = `zed-${stamp}@example.com`;
  const reg = await (await browser.newContext()).newPage();
  await reg.goto("/register");
  await reg.getByLabel("Distributor").check();
  await reg.getByLabel("Name", { exact: true }).fill(name);
  await reg.getByLabel("Email").fill(email);
  await reg.getByLabel("Password").fill("password123");
  await reg.getByLabel("Phone").fill("9876543299");
  await reg.getByLabel("Business name").fill(`${name} Traders`);
  await reg.getByLabel("City").fill("Pune");
  await reg.getByRole("button", { name: "Create account" }).click();
  await expect(reg).toHaveURL(/\/pending$/);

  const admin = await login(browser, "admin@example.com", "AdminPass123!");
  await admin.goto("/admin/approvals");
  await expect(admin.getByRole("link", { name: "Approvals" })).toHaveAttribute("aria-current", "page");
  await admin.getByRole("button", { name: `Approve ${name}` }).click();
  await expect(admin.getByRole("button", { name: `Revoke access ${name}` })).toBeVisible();

  await admin.getByLabel("Supplier (provider or distributor)").selectOption({ label: "Anjani Cement (provider, Nalgonda)" });
  await admin.getByLabel("Buyer (distributor or customer)").selectOption({ label: `${name} Traders (distributor, Pune)` });
  await admin.getByRole("button", { name: "Link parties" }).click();
  await expect(admin.getByText("Linked. The link is active.")).toBeVisible();

  const zed = await login(browser, email, "password123");
  await zed.goto("/distributor/providers");
  await expect(zed.getByRole("region", { name: "Linked" }).getByText("Anjani Cement")).toBeVisible();

  await admin.getByRole("button", { name: `Revoke access ${name}` }).click();
  await admin.getByRole("button", { name: "Confirm revoke" }).click();
  await expect(admin.getByRole("button", { name: `Revoke access ${name}` })).toHaveCount(0);
  await zed.goto("/distributor/providers");
  await expect(zed).toHaveURL(/\/(pending|login)$/);
});
