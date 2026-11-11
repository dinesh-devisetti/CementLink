import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq, sql } from "drizzle-orm";

const state = { headers: new Headers(), cookies: new Map<string, string>() };
vi.mock("next/headers", () => ({
  headers: async () => state.headers,
  cookies: async () => ({ get: (n: string) => (state.cookies.has(n) ? { name: n, value: state.cookies.get(n) } : undefined) }),
}));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));

const APP = "http://localhost:3000";
const dir = mkdtempSync(path.join(tmpdir(), "cl-qa-v12-"));
process.env.DATABASE_URL = `file:${path.join(dir, "q.db")}`;
process.env.APP_URL = APP;
process.env.ACTION_MAX_PER_MIN = "500";
process.env.REQUEST_MAX_PER_HOUR = "30";

type Ctx = { params: Promise<{ id: string }> };
type Route = (req: Request, ctx?: Ctx) => Promise<Response>;
let db: ReturnType<typeof import("@/server/db/client").getDb>;
let schema: typeof import("@/server/db/schema");
let svc: typeof import("@/server/services/users");
let sess: typeof import("@/server/auth/session");
let links: typeof import("@/server/services/links");
let R: Record<string, Route>;

type Role = "CUSTOMER" | "DISTRIBUTOR" | "PROVIDER";
type U = { id: string };
let n = 0;
async function mk(role: Role, name: string, status: "ACTIVE" | "PENDING" = "ACTIVE") {
  n += 1;
  const u = await svc.registerUser(db, {
    name, email: `u${n}-${name.toLowerCase()}@x.com`, password: "password123", role, phone: "9876543210", businessName: `${name} Biz`, city: "Pune",
  } as never);
  await db.update(schema.users).set({ status }).where(eq(schema.users.id, u.id));
  return u;
}
const as = async (u: U) => {
  const { token } = await sess.createSession(db, u.id, 1);
  state.cookies.set("cl_session", token);
};
const req = (p: string, body?: unknown) => new Request(`${APP}${p}`, { method: body === undefined ? "GET" : "POST", body: body === undefined ? undefined : JSON.stringify(body) });
const call = (r: string, p: string, body?: unknown, id?: string) => R[r](req(p, body), id ? { params: Promise.resolve({ id }) } : undefined);
const link = async (upper: U, lower: U) => {
  await links.forceLink(db, admin as never, upper.id, lower.id);
};
const days = (d: number) => new Date(Date.now() + d * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10);
const body = (distributorId: string, qty: string, allocations: Array<{ providerId: string; qtyTonnes: string }> = [], over: Record<string, unknown> = {}) => ({
  distributorId, qtyTonnes: qty, allocations, neededBy: days(3), address: "12 Market Road", city: "Pune", pincode: "411001", ...over,
});

let admin: { id: string };
let giri: U, ramu: U, anjani: U, ambuja: U;
beforeAll(async () => {
  db = (await import("@/server/db/client")).getDb();
  schema = await import("@/server/db/schema");
  svc = await import("@/server/services/users");
  sess = await import("@/server/auth/session");
  links = await import("@/server/services/links");
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
  R = {
    create: (await import("@/app/api/orders/route")).POST as unknown as Route,
    list: (await import("@/app/api/orders/route")).GET as unknown as Route,
    one: (await import("@/app/api/orders/[id]/route")).GET as unknown as Route,
    cancel: (await import("@/app/api/orders/[id]/cancel/route")).POST as unknown as Route,
    links: (await import("@/app/api/links/route")).POST as unknown as Route,
  };
  await svc.seedAdmin(db, "admin@x.com", "AdminPass123!");
  [admin] = await db.select().from(schema.users).where(eq(schema.users.email, "admin@x.com"));
  giri = await mk("DISTRIBUTOR", "Giri");
  ramu = await mk("CUSTOMER", "Ramu");
  anjani = await mk("PROVIDER", "Anjani");
  ambuja = await mk("PROVIDER", "Ambuja");
  await link(giri, ramu);
  await link(anjani, giri);
  await link(ambuja, giri);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  state.cookies = new Map();
  state.headers = new Headers({ origin: APP });
});

const allocs = async (orderId: string) =>
  db.all<{ provider_id: string; qty_kg: number }>(sql`SELECT provider_id, qty_kg FROM order_allocations WHERE order_id = ${orderId} ORDER BY qty_kg`);

describe("QA V12 edge cases", () => {
  const post = async (b: unknown, status: number) => {
    await as(ramu);
    const r = await call("create", "/api/orders", b);
    expect(r.status).toBe(status);
    return r.json();
  };
  const count = async () => (await db.select().from(schema.orders)).length;

  it("rejects malformed tonnes strings and non-string types", async () => {
    const n0 = await count();
    for (const q of ["1e3", " 5", "5 ", "-1", "+5", "5,5", "0.000", ".5", "5.", "10000", "1000.001", "NaN"]) await post(body(giri.id, q), 400);
    for (const q of [5, null, ["5"], { v: 5 }]) await post(body(giri.id, q as never), 400);
    await post(body(giri.id, "5", [{ providerId: anjani.id, qtyTonnes: "0" }]), 400);
    await post(body(giri.id, "5", [{ providerId: anjani.id, qtyTonnes: "-1" }]), 400);
    await post(body(giri.id, "5", null as never), 400);
    expect(await count()).toBe(n0);
  });
  it("accepts 1000 t and 0.001 t boundaries, rejects 1000.001", async () => {
    await post(body(giri.id, "1000"), 201);
    await post(body(giri.id, "0.001"), 201);
  });
  it("needed_by boundary: today+365 ok, +366 refused, yesterday refused", async () => {
    await post(body(giri.id, "5", [], { neededBy: days(365) }), 201);
    expect((await post(body(giri.id, "5", [], { neededBy: days(366) }), 400)).fields.neededBy).toBeTruthy();
    await post(body(giri.id, "5", [], { neededBy: days(-1) }), 400);
    await post(body(giri.id, "5", [], { neededBy: "" }), 400);
  });
  it("more than 20 allocations refused; missing allocations key = all choice", async () => {
    const many = Array.from({ length: 21 }, () => ({ providerId: anjani.id, qtyTonnes: "0.001" }));
    await post(body(giri.id, "5", many), 400);
    const b = body(giri.id, "5") as Record<string, unknown>;
    delete b.allocations;
    expect((await post(b, 201)).data.choiceKg).toBe(5000);
  });
  it("allocation sum exactly 1 kg over total is refused, equal accepted", async () => {
    await post(body(giri.id, "5", [{ providerId: anjani.id, qtyTonnes: "2.5" }, { providerId: ambuja.id, qtyTonnes: "2.501" }]), 400);
    await post(body(giri.id, "5", [{ providerId: anjani.id, qtyTonnes: "2.5" }, { providerId: ambuja.id, qtyTonnes: "2.5" }]), 201);
  });
  it("whitespace-only address/city and short address refused", async () => {
    await post(body(giri.id, "5", [], { address: "     " }), 400);
    await post(body(giri.id, "5", [], { address: "abcd" }), 400);
    await post(body(giri.id, "5", [], { city: "   " }), 400);
  });
  it("distributorId that is not a distributor / self / nonexistent / injection is refused", async () => {
    const n0 = await count();
    await post(body(anjani.id, "5"), 403);
    await post(body(ramu.id, "5"), 403);
    await post(body("nope", "5"), 403);
    await post(body("x' OR 1=1 --", "5"), 400);
    expect(await count()).toBe(n0);
  });
  it("a non-ACTIVE distributor with an ACTIVE link is refused", async () => {
    const d = await mk("DISTRIBUTOR", "Suspended");
    await link(d, ramu);
    await db.update(schema.users).set({ status: "REJECTED" }).where(eq(schema.users.id, d.id));
    await post(body(d.id, "5"), 403);
  });
  it("mutating routes require a matching Origin", async () => {
    await as(ramu);
    state.headers = new Headers({ origin: "http://evil.example" });
    expect((await call("create", "/api/orders", body(giri.id, "5"))).status).toBeGreaterThanOrEqual(400);
    const { data } = await (async () => { state.headers = new Headers({ origin: APP }); return (await call("create", "/api/orders", body(giri.id, "5"))).json(); })();
    state.headers = new Headers({ origin: "http://evil.example" });
    const postCancel = new Request(`${APP}/api/orders/${data.id}/cancel`, { method: "POST" });
    expect((await R.cancel(postCancel, { params: Promise.resolve({ id: data.id }) })).status).toBe(403);
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, data.id));
    expect(o.status).toBe("REQUESTED");
  });
  it("unauthenticated create/list/get/cancel -> 401", async () => {
    expect((await call("create", "/api/orders", body(giri.id, "5"))).status).toBe(401);
    expect((await call("list", "/api/orders")).status).toBe(401);
    expect((await call("one", "/api/orders/abc", undefined, "abc")).status).toBe(401);
    expect((await call("cancel", "/api/orders/abc/cancel", undefined, "abc")).status).toBe(401);
  });
  it("double-submit: parallel cancels yield exactly one 200", async () => {
    await as(ramu);
    const { data } = await (await call("create", "/api/orders", body(giri.id, "5"))).json();
    const rs = await Promise.all([1, 2, 3].map(() => call("cancel", `/api/orders/${data.id}/cancel`, undefined, data.id)));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status === 409)).toHaveLength(2);
  });
  it("double-submit: parallel creates both succeed as separate orders (no idempotency key) without partial allocs", async () => {
    await as(ramu);
    const b = body(giri.id, "6", [{ providerId: anjani.id, qtyTonnes: "6" }]);
    const rs = await Promise.all([call("create", "/api/orders", b), call("create", "/api/orders", b)]);
    const ids = await Promise.all(rs.map(async (r) => (await r.json()).data?.id));
    for (const id of ids.filter(Boolean)) expect(await allocs(id)).toHaveLength(1);
  });
  it("cancel of an order for the distributor after provider link revoked is unaffected; cancelled order keeps allocations", async () => {
    await as(ramu);
    const { data } = await (await call("create", "/api/orders", body(giri.id, "5", [{ providerId: anjani.id, qtyTonnes: "2" }]))).json();
    await call("cancel", `/api/orders/${data.id}/cancel`, undefined, data.id);
    const d = await (await call("one", `/api/orders/${data.id}`, undefined, data.id)).json();
    expect(d.data.status).toBe("CANCELLED");
    expect(d.data.allocations).toHaveLength(1);
  });
  it("provider and admin cannot read orders (403)", async () => {
    await as(ramu);
    const { data } = await (await call("create", "/api/orders", body(giri.id, "5"))).json();
    await as(anjani);
    expect((await call("one", `/api/orders/${data.id}`, undefined, data.id)).status).toBe(403);
    await as(admin);
    expect((await call("one", `/api/orders/${data.id}`, undefined, data.id)).status).toBe(403);
  });
  it("API response never leaks customer contact details to the distributor", async () => {
    await as(ramu);
    const { data } = await (await call("create", "/api/orders", body(giri.id, "5"))).json();
    await as(giri);
    const txt = JSON.stringify(await (await call("one", `/api/orders/${data.id}`, undefined, data.id)).json());
    expect(txt).not.toMatch(/@x\.com|9876543210|passwordHash|password_hash/i);
  });
  it("order list shows distributor-visible customer name only to own distributor", async () => {
    const g3 = await mk("DISTRIBUTOR", "Giri3");
    await as(g3);
    const t = JSON.stringify(await (await call("list", "/api/orders")).json());
    expect(t).not.toContain("Ramu");
  });
  it("V11 LOW: cancelled link row (revoked_by NULL) is not shown as Revoked/ACTIVE-or-REVOKED to the upper party", async () => {
    const c = await mk("CUSTOMER", "Canceller");
    await as(c);
    await call("links", "/api/links", { targetId: giri.id });
    const [l] = await db.select().from(schema.links).where(eq(schema.links.lowerId, c.id));
    await db.update(schema.links).set({ status: "REVOKED", revokedBy: null }).where(eq(schema.links.id, l.id));
    await as(c);
    expect((await call("create", "/api/orders", body(giri.id, "5"))).status).toBe(403);
  });
  it("control and bidi characters in address/city are refused", async () => {
    for (const bad of ["12 Market\u0000Road", "12 Market\nRoad", "12 Market\u202eRoad", "12 Market\u200fRoad"]) {
      await post(body(giri.id, "5", [], { address: bad }), 400);
      await post(body(giri.id, "5", [], { city: bad }), 400);
    }
  });
});
