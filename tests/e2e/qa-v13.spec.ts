import { expect, test, type Browser, type Page } from "@playwright/test";

const DEMO = "DemoPass123!";
async function login(browser: Browser, email: string): Promise<Page> {
  const page = await (await browser.newContext({ viewport: { width: 360, height: 740 } })).newPage();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(DEMO);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  return page;
}
const future = () => new Date(Date.now() + 6 * 86_400_000).toISOString().slice(0, 10);

test("QA V13: a DRAFT is invisible to the provider and customer (UI and API), distributor pages fit 360px", async ({ browser }) => {
  const ramu = await login(browser, "ramu@example.com");
  await ramu.goto("/customer/orders/new");
  await ramu.getByLabel("Distributor").selectOption({ label: "Giri Traders" });
  await ramu.getByLabel("Total quantity (tonnes)").fill("8.5");
  await ramu.getByLabel("Needed by").fill(future());
  await ramu.getByLabel("Delivery address").fill("QA Lane 7");
  await ramu.getByLabel("City").fill("Hyderabad");
  await ramu.getByLabel("Pincode").fill("500002");
  await ramu.getByRole("button", { name: "Place order" }).click();
  await expect(ramu).toHaveURL(/\/customer\/orders\/(?!new$)[\w-]+$/);
  const orderId = ramu.url().split("/").pop() as string;

  const giri = await login(browser, "giri@example.com");
  await giri.goto(`/distributor/orders/${orderId}`);
  await expect(giri.getByRole("heading", { name: "Drafts (1)" })).toBeVisible();
  for (const p of [`/distributor/orders/${orderId}`, "/distributor/pos"]) {
    await giri.goto(p);
    expect(await giri.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), p).toBe(true);
  }
  const list = await (await giri.request.get(`/api/pos?status=DRAFT&orderId=${orderId}`)).json();
  expect(list.data).toHaveLength(1);
  const draftId = list.data[0].id as string;

  const anjani = await login(browser, "anjani@example.com");
  const ambuja = await login(browser, "ambuja@example.com");
  for (const prov of [anjani, ambuja]) {
    expect((await prov.request.get(`/api/pos/${draftId}`)).status()).toBe(404);
    await prov.goto(`/provider/orders/${draftId}`);
    await expect(prov.getByText("QA Lane 7")).toHaveCount(0);
    await prov.goto("/provider/orders");
    await expect(prov.getByText("8.5 t")).toHaveCount(0);
  }
  expect((await ramu.request.get(`/api/pos/${draftId}`)).status()).toBe(404);
  await ramu.goto(`/customer/orders/${orderId}`);
  await expect(ramu.getByText(/Draft/i)).toHaveCount(0);
  // role fencing: customer cannot reach the distributor draft page
  await ramu.goto(`/distributor/orders/${orderId}`);
  await expect(ramu).not.toHaveURL(/\/distributor\/orders\//);
});
