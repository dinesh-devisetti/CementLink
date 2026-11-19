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
const dir = mkdtempSync(path.join(tmpdir(), "cl-qa21-"));
process.env.DATABASE_URL = `file:${path.join(dir, "q.db")}`;
process.env.APP_URL = APP;

type Route = (req: Request) => Promise<Response>;
let db: ReturnType<typeof import("@/server/db/client").getDb>;
let sess: typeof import("@/server/auth/session");
let R: Record<string, Route>;
const T0 = Date.UTC(2026, 0, 1);
let seq = 0;
const as = async (id: string) => { state.cookies.set("cl_session", (await sess.createSession(db, id, 1)).token); };
const get = async (r: string, qs: string) => (await R[r](new Request(`${APP}/x${qs}`))).json();
const names = (j: { data: Array<{ customer?: string; distributor?: string }> }) => j.data.map((d) => d.customer ?? d.distributor);

async function user(id: string, role: string, business: string | null, city = "Pune", email = `${id}@x.com`) {
  await db.run(sql`INSERT INTO users (id, email, password_hash, role, status, name, business_name, city, created_at) VALUES (${id}, ${email}, 'x', ${role}, 'ACTIVE', ${"N-" + id}, ${business}, ${city}, ${T0 + seq++})`);
}
async function order(id: string, cust: string, at: number) {
  await db.run(sql`INSERT INTO orders (id, customer_id, distributor_id, qty_kg, address, city, pincode, needed_by, status, created_at, updated_at) VALUES (${id}, ${cust}, 'd1', 1000, 'A', 'Pune', '411001', '2027-01-01', 'REQUESTED', ${at}, ${at})`);
}

beforeAll(async () => {
  db = (await import("@/server/db/client")).getDb();
  sess = await import("@/server/auth/session");
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
  R = {
    dist: (await import("@/app/api/admin/analytics/distributors/route")).GET as unknown as Route,
    disp: (await import("@/app/api/admin/dispatches/route")).GET as unknown as Route,
    cust: (await import("@/app/api/admin/customers/route")).GET as unknown as Route,
  };
  await user("admin", "ADMIN", null);
  await user("d1", "DISTRIBUTOR", "Alpha");
  await user("d2", "DISTRIBUTOR", "100% Cement");
  await user("d3", "DISTRIBUTOR", "a_b Traders");
  await user("d4", "DISTRIBUTOR", "O'Brien \"Q\"");
  await user("d5", "DISTRIBUTOR", "Zürich Ünï");
  await user("d6", "DISTRIBUTOR", "X".repeat(85));
  await user("cEarly", "CUSTOMER", "Early", "Pune", "early@x.com");
  await user("cLate", "CUSTOMER", "Late", "Pune", "late@x.com");
  await order("oe", "cEarly", Date.UTC(2026, 2, 10, 18, 29, 59)); // 23:59:59 IST 10 Mar
  await order("ol", "cLate", Date.UTC(2026, 2, 10, 18, 30, 0)); // 00:00:00 IST 11 Mar
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("QA V21", () => {
  it("IST day boundary: 23:59:59 IST (18:29:59Z) is Mar 10, 00:00 IST is Mar 11", async () => {
    await as("admin");
    expect(names(await get("cust", "?from=2026-03-10&to=2026-03-10"))).toEqual(["Early"]);
    expect(names(await get("cust", "?from=2026-03-11&to=2026-03-11"))).toEqual(["Late"]);
    expect((await get("cust", "?from=2026-03-10&to=2026-03-11")).meta.total).toBe(2);
    expect((await get("cust", "?to=2026-03-09")).meta.total).toBe(0);
    expect((await get("cust", "?from=2026-03-12")).meta.total).toBe(0);
  });
  it("invalid dates and from>to never 500", async () => {
    await as("admin");
    for (const qs of ["?from=2026-02-30", "?from=abc&to=", "?from=2026-13-01", "?from=2026-3-1", "?from=2026-03-11&to=2026-03-10", "?from[]=x&q[]=y", "?from=%00", "?q=%ZZ"]) {
      for (const r of ["dist", "disp", "cust"]) expect((await R[r](new Request(`${APP}/x${qs}`))).status, `${r}${qs}`).toBe(200);
    }
    expect((await get("cust", "?from=2026-03-11&to=2026-03-10")).meta.total).toBe(2); // range dropped
  });
  it("q literal handling", async () => {
    await as("admin");
    expect(names(await get("dist", "?q=%25"))).toEqual(["100% Cement"]);
    expect(names(await get("dist", "?q=_"))).toEqual(["a_b Traders"]);
    expect(names(await get("dist", "?q=a_b"))).toEqual(["a_b Traders"]);
    expect(names(await get("dist", `?q=${encodeURIComponent("O'Brien \"Q\"")}`))).toEqual(["O'Brien \"Q\""]);
    expect((await get("dist", `?q=${encodeURIComponent("' OR 1=1 --")}`)).meta.total).toBe(0);
    expect((await get("dist", `?q=${encodeURIComponent("\\")}`)).meta.total).toBe(0);
    expect(names(await get("dist", `?q=${encodeURIComponent("Zürich")}`))).toEqual(["Zürich Ünï"]);
    expect((await get("dist", "?q=%09%0A%01")).meta.total).toBe(6); // control-only => blank => no filter
    expect(names(await get("dist", "?q=Al%00pha")).length).toBe(0); // NUL becomes a space, no crash
  });
  it("q 81+ chars truncated to 80 (still matches 85 X name)", async () => {
    await as("admin");
    expect((await get("dist", `?q=${"X".repeat(200)}`)).meta.total).toBe(1);
  });
  it("401 anon, 403 non-admin with filters", async () => {
    for (const r of ["dist", "disp", "cust"]) {
      state.cookies.clear();
      expect((await R[r](new Request(`${APP}/x?q=a&from=2026-01-01`))).status).toBe(401);
      await as("d1");
      expect((await R[r](new Request(`${APP}/x?q=a`))).status).toBe(403);
    }
  });
});
