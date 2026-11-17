import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { sql } from "drizzle-orm";

const state = { headers: new Headers(), cookies: new Map<string, string>() };
vi.mock("next/headers", () => ({
  headers: async () => state.headers,
  cookies: async () => ({ get: (n: string) => (state.cookies.has(n) ? { name: n, value: state.cookies.get(n) } : undefined) }),
}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));

const APP = "http://localhost:3000";
const dir = mkdtempSync(path.join(tmpdir(), "cl-an-"));
process.env.DATABASE_URL = `file:${path.join(dir, "an.db")}`;
process.env.APP_URL = APP;

type Route = (req: Request, ctx?: { params: Promise<{ id: string }> }) => Promise<Response>;
let db: ReturnType<typeof import("@/server/db/client").getDb>;
let sess: typeof import("@/server/auth/session");
let R: Record<string, Route>;
const NOW = Date.UTC(2026, 0, 10);

async function user(id: string, role: string, business: string | null, status = "ACTIVE") {
  await db.run(sql`INSERT INTO users (id, email, password_hash, role, status, name, business_name, city, created_at) VALUES (${id}, ${id + "@x.com"}, 'x', ${role}, ${status}, ${"N-" + id}, ${business}, 'Pune', ${NOW + seq++})`);
}
let seq = 0;
const as = async (id: string) => { state.cookies.set("cl_session", (await sess.createSession(db, id, 1)).token); };
const get = (r: string, p: string, id?: string) => R[r](new Request(`${APP}${p}`), id ? { params: Promise.resolve({ id }) } : undefined);
async function order(id: string, cust: string, dist: string, kg: number, status: string) {
  await db.run(sql`INSERT INTO orders (id, customer_id, distributor_id, qty_kg, address, city, pincode, needed_by, status, created_at, updated_at) VALUES (${id}, ${cust}, ${dist}, ${kg}, 'A', 'Pune', '411001', '2026-02-01', ${status}, ${NOW + seq++}, ${NOW})`);
}

beforeAll(async () => {
  db = (await import("@/server/db/client")).getDb();
  sess = await import("@/server/auth/session");
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
  R = {
    dist: (await import("@/app/api/admin/analytics/distributors/route")).GET as unknown as Route,
    disp: (await import("@/app/api/admin/dispatches/route")).GET as unknown as Route,
    cust: (await import("@/app/api/admin/customers/route")).GET as unknown as Route,
    custId: (await import("@/app/api/admin/customers/[id]/route")).GET as unknown as Route,
  };
  await user("admin", "ADMIN", null);
  await user("g", "DISTRIBUTOR", "Giri");
  await user("rev", "DISTRIBUTOR", "Revoked", "REJECTED");
  await user("pa", "PROVIDER", "Anjani");
  await user("c1", "CUSTOMER", "Ramu");
  for (let i = 0; i < 55; i++) await order(`o${i}`, "c1", "g", 1000, "REQUESTED");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("QA V19 edge cases", () => {
  it("every role other than ADMIN is 403 on all four routes; anon 401", async () => {
    for (const who of ["g", "pa", "c1"]) {
      await as(who);
      for (const [r, p, id] of [["dist", "/api/admin/analytics/distributors"], ["disp", "/api/admin/dispatches"], ["cust", "/api/admin/customers"], ["custId", "/x", "c1"]] as const)
        expect((await get(r, p, id)).status).toBe(403);
    }
    state.cookies.clear();
    expect((await get("custId", "/x", "c1")).status).toBe(401);
  });
  it.each(["page=-1", "page=1.5", "page=99999999999", "limit=1e3", "limit=1.5", "page=Infinity", "limit=-5", "page=0x10"])("%s is 400 or sane", async (q) => {
    await as("admin");
    for (const [r, p] of [["dist", "/api/admin/analytics/distributors"], ["disp", "/api/admin/dispatches"], ["cust", "/api/admin/customers"]] as const) {
      const st = (await get(r, `${p}?${q}`)).status;
      expect([200, 400]).toContain(st);
    }
  });
  it("empty page= / limit= params: default or 400, never 500", async () => {
    await as("admin");
    expect([200, 400]).toContain((await get("cust", "/api/admin/customers?page=&limit=")).status);
  });
  it("customer detail paginates 55 orders: 50 + 5, no overlap", async () => {
    await as("admin");
    const a = await (await get("custId", "/x?limit=50", "c1")).json();
    const b = await (await get("custId", "/x?limit=50&page=2", "c1")).json();
    expect([a.data.orders.length, b.data.orders.length, a.meta.total]).toEqual([50, 5, 55]);
    const ids = new Set([...a.data.orders, ...b.data.orders].map((o: { orderId: string }) => o.orderId));
    expect(ids.size).toBe(55);
  });
  it("unknown / odd customer ids never 500", async () => {
    await as("admin");
    for (const id of ["nope", "' OR 1=1 --", "a".repeat(500), "%00"]) expect([400, 404]).toContain((await get("custId", "/x", id)).status);
  });
});
