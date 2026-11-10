import { defineConfig, devices } from "@playwright/test";

const PORT = 3100;

export default defineConfig({
  testDir: "./tests/e2e",
  workers: 1,
  fullyParallel: false,
  use: { baseURL: `http://localhost:${PORT}`, headless: true },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // reset + migrate + seed the e2e DB before the server starts (deleting the file afterwards would break the open handle)
    command: `rm -f tests/e2e.db* && npm run db:migrate && npm run seed && npm run build && npm start -- -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      NEXT_DIST_DIR: ".next-e2e",
      DATABASE_URL: "file:./tests/e2e.db",
      APP_URL: `http://localhost:${PORT}`,
      PAYMENT_GATEWAY: "fake",
      E2E: "1",
      ADMIN_SEED_EMAIL: "admin@example.com",
      ADMIN_SEED_PASSWORD: "AdminPass123!",
      COOKIE_SECURE: "false",
    },
  },
});
