import { expect, test, type Browser, type Page } from "@playwright/test";

const DEMO = "DemoPass123!";
async function login(browser: Browser, email: string, password = DEMO): Promise<{ page: Page; csp: string[] }> {
  const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
  const csp: string[] = [];
  page.on("console", (m) => { if (/content security policy|refused to/i.test(m.text())) csp.push(m.text()); });
  page.on("pageerror", (e) => { if (/content security policy/i.test(e.message)) csp.push(e.message); });
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).not.toHaveURL(/\/login$/);
  return { page, csp };
}

test("QA V20: headers on page, API 401, 404, and no HSTS on e2e http server", async ({ request }) => {
  for (const url of ["/login", "/api/payments", "/api/admin/analytics/distributors", "/nope-404"]) {
    const res = await request.get(url);
    const h = res.headers();
    expect(h["content-security-policy"], url).toContain("frame-ancestors 'none'");
    expect(h["content-security-policy"], url).not.toContain("unsafe-eval");
    expect(h["x-frame-options"], url).toBe("DENY");
    expect(h["x-content-type-options"], url).toBe("nosniff");
    expect(h["referrer-policy"], url).toBeTruthy();
    expect(h["permissions-policy"], url).toBeTruthy();
    expect(h["strict-transport-security"], url).toBeUndefined();
  }
  for (const url of ["/api/payments", "/api/admin/analytics/distributors", "/api/orders", "/api/balances"]) {
    const res = await request.get(url);
    expect(res.status(), url).toBe(401);
    expect(res.headers()["cache-control"], url).toBe("no-store");
  }
  const bad = await request.post("/api/orders", { data: "not json", headers: { "content-type": "application/json" } });
  expect([400, 401, 403]).toContain(bad.status());
  expect(bad.headers()["cache-control"]).toBe("no-store");
});

test("QA V20: /api/me (not under withAuth) has no-store", async ({ browser }) => {
  const { page } = await login(browser, "ramu@example.com");
  const res = await page.request.get("/api/me");
  expect(res.status()).toBe(200);
  expect(res.headers()["cache-control"]).toBe("no-store");
});

test("QA V20: 403 for wrong role carries no-store", async ({ browser }) => {
  const { page } = await login(browser, "ramu@example.com");
  const res = await page.request.get("/api/admin/analytics/distributors");
  expect(res.status()).toBe(403);
  expect(res.headers()["cache-control"]).toBe("no-store");
});

test("QA V20: framing is blocked", async ({ page }) => {
  const msgs: string[] = [];
  page.on("console", (m) => msgs.push(m.text()));
  await page.route("http://other.test/**", (r) => r.fulfill({ contentType: "text/html", body: `<iframe id=f src="http://localhost:3100/login"></iframe>` }));
  await page.goto("http://other.test/");
  await page.waitForTimeout(1500);
  const frame = page.frames().find((f) => f.url().includes("localhost:3100/login"));
  const hasForm = frame ? await frame.locator("input").count().catch(() => 0) : 0;
  expect(hasForm).toBe(0);
  void msgs;
});

test("QA V20: no CSP violations on key pages across roles", async ({ browser }) => {
  const admin = await login(browser, "admin@example.com", "AdminPass123!");
  for (const p of ["/admin", "/admin/distributors", "/admin/customers"]) {
    await admin.page.goto(p);
    await admin.page.waitForLoadState("networkidle");
  }
  expect(admin.csp).toEqual([]);
  for (const email of ["ramu@example.com", "giri@example.com"]) {
    const u = await login(browser, email);
    await u.page.goto("/");
    await u.page.waitForLoadState("networkidle");
    await u.page.goto("/customer/invoices").catch(() => undefined);
    await u.page.waitForLoadState("networkidle");
    expect(u.csp, email).toEqual([]);
  }
});

test("QA V20: login and logout API responses carry no-store", async ({ request }) => {
  const bad = await request.post("/api/auth/login", { data: { email: "nobody@example.com", password: "wrong-password-1" } });
  expect(bad.headers()["cache-control"]).toBe("no-store");
  const out = await request.post("/api/auth/logout");
  expect(out.headers()["cache-control"]).toBe("no-store");
});
