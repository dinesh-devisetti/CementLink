import { expect, test } from "@playwright/test";

test("register customer -> customer dashboard -> logout -> login again", async ({ page }) => {
  const email = `cust-${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Name", { exact: true }).fill("Ravi Kumar");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByLabel("Phone").fill("9876543210");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/customer$/);
  await expect(page.getByRole("heading", { name: "Customer dashboard" })).toBeVisible();

  await page.getByRole("button", { name: "Log out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/customer$/);
  await expect(page.getByRole("heading", { name: "Customer dashboard" })).toBeVisible();
});

test("customer cannot open the admin dashboard; anonymous is sent to login", async ({ page }) => {
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/login$/);

  const email = `cust2-${Date.now()}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Name", { exact: true }).fill("Sita");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("password123");
  await page.getByLabel("Phone").fill("9876543211");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/customer$/);
  await page.goto("/admin");
  await expect(page).toHaveURL(/\/customer$/);
});

test("distributor registers and is sent to the pending stub; admin logs in", async ({ page }) => {
  await page.goto("/register");
  await page.getByLabel("Distributor").check();
  await page.getByLabel("Name", { exact: true }).fill("Sharma");
  await page.getByLabel("Email").fill(`dist-${Date.now()}@example.com`);
  await page.getByLabel("Password").fill("password123");
  await page.getByLabel("Phone").fill("9876543212");
  await page.getByLabel("Business name").fill("Sharma Traders");
  await page.getByLabel("City").fill("Pune");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/pending$/);
  await expect(page.getByRole("heading", { name: "Waiting for admin approval" })).toBeVisible();
  await page.goto("/distributor");
  await expect(page).toHaveURL(/\/pending$/);
  await page.getByRole("button", { name: "Log out" }).click();

  await page.getByLabel("Email").fill("admin@example.com");
  await page.getByLabel("Password").fill("AdminPass123!");
  await page.getByRole("button", { name: "Log in" }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Admin dashboard" })).toBeVisible();
});

test("register distributor -> pending -> admin approves -> login -> /distributor; reject blocks", async ({ page }) => {
  const stamp = Date.now();
  const approved = `appr-${stamp}@example.com`;
  const rejected = `rej-${stamp}@example.com`;
  const register = async (email: string, name: string) => {
    await page.goto("/register");
    await page.getByLabel("Distributor").check();
    await page.getByLabel("Name", { exact: true }).fill(name);
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill("password123");
    await page.getByLabel("Phone").fill("9876543213");
    await page.getByLabel("Business name").fill(`${name} Traders`);
    await page.getByLabel("City").fill("Pune");
    await page.getByRole("button", { name: "Create account" }).click();
    await expect(page).toHaveURL(/\/pending$/);
    await page.getByRole("button", { name: "Log out" }).click();
    await expect(page).toHaveURL(/\/login$/);
  };
  const login = async (email: string, password: string) => {
    await page.getByLabel("Email").fill(email);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Log in" }).click();
  };
  await register(approved, `Approve${stamp}`);
  await register(rejected, `Reject${stamp}`);

  await login("admin@example.com", "AdminPass123!");
  await expect(page).toHaveURL(/\/admin$/);
  await page.getByRole("button", { name: `Approve Approve${stamp}` }).click();
  await expect(page.getByRole("button", { name: `Approve Approve${stamp}` })).toHaveCount(0);
  await page.getByRole("button", { name: `Reject Reject${stamp}` }).click();
  await expect(page.getByRole("button", { name: `Reject Reject${stamp}` })).toHaveCount(0);
  await page.getByRole("button", { name: "Log out" }).click();

  await page.goto("/login");
  await login(approved, "password123");
  await expect(page).toHaveURL(/\/distributor$/);
  await page.getByRole("button", { name: "Log out" }).click();

  await login(rejected, "password123");
  await expect(page).toHaveURL(/\/pending$/);
  await expect(page.getByRole("heading", { name: "Your account was not approved" })).toBeVisible();
  await page.goto("/distributor");
  await expect(page).toHaveURL(/\/pending$/);
});
