import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";

const state = { headers: new Headers() };
vi.mock("next/headers", () => ({ headers: async () => state.headers, cookies: async () => ({ get: () => undefined }) }));
vi.mock("next/navigation", () => ({ redirect: (t: string) => { throw new Error(`REDIRECT:${t}`); } }));

const APP = "http://localhost:3000";
const dir = mkdtempSync(path.join(tmpdir(), "cl-qa-"));
process.env.DATABASE_URL = `file:${path.join(dir, "q.db")}`;
process.env.APP_URL = APP;
process.env.LOGIN_MAX_ATTEMPTS = "5";
process.env.TRUST_PROXY = "false";

const req = (body: unknown, xff?: string) =>
  new Request(`${APP}/x`, { method: "POST", body: JSON.stringify(body), headers: xff ? { "x-forwarded-for": xff, "x-real-ip": xff } : {} });

let login: typeof import("@/app/api/auth/login/route").POST;
let register: typeof import("@/app/api/auth/register/route").POST;

beforeAll(async () => {
  const dbmod = await import("@/server/db/client");
  await migrate(dbmod.getDb(), { migrationsFolder: path.join(process.cwd(), "drizzle") });
  login = (await import("@/app/api/auth/login/route")).POST;
  register = (await import("@/app/api/auth/register/route")).POST;
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("QA V1 re-check", () => {
  it("rotating spoofed X-Forwarded-For / X-Real-IP does not evade the limit (TRUST_PROXY=false); 429 has Retry-After", async () => {
    state.headers = new Headers({ origin: APP });
    const codes = await Promise.all(
      Array.from({ length: 20 }, (_, i) => login(req({ email: "victim@x.com", password: "wrong-pass-1" }, `9.9.9.${i}`))),
    );
    const statuses = codes.map((r) => r.status);
    expect(statuses.filter((s) => s === 401).length).toBeLessThanOrEqual(5);
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(15);
    const limited = codes.find((r) => r.status === 429)!;
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });
  it("register has no per-IP bucket without TRUST_PROXY (does not 429 on a shared 'unknown' bucket)", async () => {
    state.headers = new Headers({ origin: APP });
    const s: number[] = [];
    for (let i = 0; i < 7; i++)
      s.push((await register(req({ name: "A", email: `r${i}@x.com`, password: "password123", role: "CUSTOMER", phone: "9876543210" }, "1.2.3.4"))).status);
    expect(s.every((x) => x === 201)).toBe(true);
  });
});
