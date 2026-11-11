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
const dir = mkdtempSync(path.join(tmpdir(), "cl-orders-"));
process.env.DATABASE_URL = `file:${path.join(dir, "o.db")}`;
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
const req = (p: string, body?: unknown, post = body !== undefined) =>
  new Request(`${APP}${p}`, { method: post ? "POST" : "GET", body: body === undefined ? undefined : JSON.stringify(body) });
const call = (r: string, p: string, body?: unknown, id?: string) =>
  R[r](req(p, body, body !== undefined || p.endsWith("/cancel")), id ? { params: Promise.resolve({ id }) } : undefined);
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

describe("S3 must-pass order shapes (service level)", () => {
  it("Case 1: Ramu orders 30 t from Giri, 10 t Anjani + 20 t Ambuja, nothing left for Giri's choice", async () => {
    await as(ramu);
    const res = await call("create", "/api/orders", body(giri.id, "30", [{ providerId: anjani.id, qtyTonnes: "10" }, { providerId: ambuja.id, qtyTonnes: "20" }]));
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data).toMatchObject({ status: "REQUESTED", qtyKg: 30000, choiceKg: 0, distributorId: giri.id });
    expect(await allocs(data.id)).toEqual([{ provider_id: anjani.id, qty_kg: 10000 }, { provider_id: ambuja.id, qty_kg: 20000 }]);
    const detail = await (await call("one", `/api/orders/${data.id}`, undefined, data.id)).json();
    expect(detail.data.allocations.map((a: { providerName: string; qtyKg: number }) => [a.providerName, a.qtyKg])).toEqual([["Anjani Biz", 10000], ["Ambuja Biz", 20000]]);
    expect(detail.data.choiceKg).toBe(0);
  });

  it("Case 2: Ramu orders 15 t with no split, all 15 t is Giri's choice", async () => {
    await as(ramu);
    const res = await call("create", "/api/orders", body(giri.id, "15"));
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data).toMatchObject({ qtyKg: 15000, choiceKg: 15000 });
    expect(await allocs(data.id)).toEqual([]);
  });

  it("partial split: remainder is the distributor's choice", async () => {
    await as(ramu);
    const { data } = await (await call("create", "/api/orders", body(giri.id, "12.5", [{ providerId: anjani.id, qtyTonnes: "2.25" }]))).json();
    expect(data.choiceKg).toBe(10250);
  });
});

describe("validation", () => {
  const bad = async (b: unknown, status = 400) => {
    await as(ramu);
    const r = await call("create", "/api/orders", b);
    expect(r.status).toBe(status);
    return r.json();
  };
  it("rejects bad tonnes, over-allocation, duplicate providers, past/invalid dates, bad pincode, long address, extra keys", async () => {
    const A = { providerId: anjani.id, qtyTonnes: "1" };
    expect((await bad(body(giri.id, "1.2345"))).fields.qtyTonnes).toBeTruthy();
    expect((await bad(body(giri.id, "0"))).fields.qtyTonnes).toBeTruthy();
    expect((await bad(body(giri.id, "1000.001"))).fields.qtyTonnes).toBeTruthy();
    expect((await bad(body(giri.id, "5", [{ providerId: anjani.id, qtyTonnes: "3" }, { providerId: ambuja.id, qtyTonnes: "2.001" }]))).code).toBe("VALIDATION");
    expect((await bad(body(giri.id, "5", [A, A]))).fields["allocations"]).toBeTruthy();
    expect((await bad(body(giri.id, "5", [], { neededBy: days(-1) }))).fields.neededBy).toBeTruthy();
    expect((await bad(body(giri.id, "5", [], { neededBy: "2026-02-30" }))).fields.neededBy).toBeTruthy();
    expect((await bad(body(giri.id, "5", [], { pincode: "41100" }))).fields.pincode).toBeTruthy();
    expect((await bad(body(giri.id, "5", [], { pincode: "41100a" }))).fields.pincode).toBeTruthy();
    expect((await bad(body(giri.id, "5", [], { address: "x".repeat(301) }))).fields.address).toBeTruthy();
    expect((await bad(body(giri.id, "5", [], { city: "" }))).fields.city).toBeTruthy();
    await bad({ ...body(giri.id, "5"), status: "PAID" });
  });
  it("accepts needed_by today (IST) and sum == total", async () => {
    await as(ramu);
    expect((await call("create", "/api/orders", body(giri.id, "5", [{ providerId: anjani.id, qtyTonnes: "5" }], { neededBy: days(0) }))).status).toBe(201);
  });
  it("rejects control and bidi characters in address and city", async () => {
    for (const bad of ["12 Road\nLine2", "12 Road\u202Eevil", "a\u200Bb Road", "tab\there"]) {
      await as(ramu);
      const r = await call("create", "/api/orders", body(giri.id, "5", [], { address: bad }));
      expect(r.status).toBe(400);
      expect((await r.json()).fields.address).toBeTruthy();
    }
    await as(ramu);
    expect((await call("create", "/api/orders", body(giri.id, "5", [], { city: "Pu\u0007ne" }))).status).toBe(400);
  });
  it("cancel is a POST and a foreign Origin is refused", async () => {
    await as(ramu);
    const { data } = await (await call("create", "/api/orders", body(giri.id, "3"))).json();
    state.headers = new Headers({ origin: "http://evil.example" });
    expect((await call("cancel", `/api/orders/${data.id}/cancel`, undefined, data.id)).status).toBe(403);
    state.headers = new Headers({ origin: APP });
    expect((await call("cancel", `/api/orders/${data.id}/cancel`, undefined, data.id)).status).toBe(200);
  });
  it("oversized body -> 413", async () => {
    await as(ramu);
    expect((await call("create", "/api/orders", body(giri.id, "5", [], { address: "x".repeat(20_000) }))).status).toBe(413);
  });
  it("only a customer can create", async () => {
    await as(giri);
    expect((await call("create", "/api/orders", body(giri.id, "5"))).status).toBe(403);
  });
});

describe("link gating", () => {
  it("unlinked, pending, rejected and revoked distributor links are refused; nothing is written", async () => {
    const lonely = await mk("CUSTOMER", "Lonely");
    const before = (await db.select().from(schema.orders)).length;
    await as(lonely);
    expect((await call("create", "/api/orders", body(giri.id, "5"))).status).toBe(403);
    await call("links", "/api/links", { targetId: giri.id });
    const r = await call("create", "/api/orders", body(giri.id, "5"));
    expect(r.status).toBe(403);
    expect((await r.json()).code).toBe("NOT_LINKED");
    const [l] = await db.select().from(schema.links).where(eq(schema.links.lowerId, lonely.id));
    for (const status of ["REJECTED", "REVOKED"] as const) {
      await db.update(schema.links).set({ status }).where(eq(schema.links.id, l.id));
      expect((await call("create", "/api/orders", body(giri.id, "5"))).status).toBe(403);
    }
    expect((await db.select().from(schema.orders)).length).toBe(before);
  });

  it("unlinked or non-active provider -> 422 and nothing written; a revoked provider link too", async () => {
    const stranger = await mk("PROVIDER", "Stranger");
    const before = (await db.select().from(schema.orders)).length;
    await as(ramu);
    const r = await call("create", "/api/orders", body(giri.id, "5", [{ providerId: stranger.id, qtyTonnes: "5" }]));
    expect(r.status).toBe(422);
    expect((await r.json()).code).toBe("PROVIDER_NOT_LINKED");
    const p = await mk("PROVIDER", "Temp");
    await link(p, giri);
    await db.update(schema.links).set({ status: "REVOKED", revokedBy: p.id }).where(eq(schema.links.upperId, p.id));
    expect((await call("create", "/api/orders", body(giri.id, "5", [{ providerId: p.id, qtyTonnes: "5" }]))).status).toBe(422);
    // a customer id as provider is not an active provider link either
    expect((await call("create", "/api/orders", body(giri.id, "5", [{ providerId: ramu.id, qtyTonnes: "5" }]))).status).toBe(422);
    expect((await db.select().from(schema.orders)).length).toBe(before);
  });

  it("a deactivated provider is refused", async () => {
    const p = await mk("PROVIDER", "Dormant");
    await link(p, giri);
    await db.update(schema.users).set({ status: "REJECTED" }).where(eq(schema.users.id, p.id));
    await as(ramu);
    expect((await call("create", "/api/orders", body(giri.id, "5", [{ providerId: p.id, qtyTonnes: "5" }]))).status).toBe(422);
  });
});

describe("rate limit", () => {
  it("REQUEST_MAX_PER_HOUR orders per customer per hour, then 429", async () => {
    const c = await mk("CUSTOMER", "Spammer");
    await link(giri, c);
    await as(c);
    for (let i = 0; i < 30; i++) expect((await call("create", "/api/orders", body(giri.id, "1"))).status).toBe(201);
    const r = await call("create", "/api/orders", body(giri.id, "1"));
    expect(r.status).toBe(429);
    expect(r.headers.get("Retry-After")).toBeTruthy();
  });
});

describe("cancel", () => {
  it("customer cancels while REQUESTED; second cancel 409; others get 404", async () => {
    await as(ramu);
    const { data } = await (await call("create", "/api/orders", body(giri.id, "3"))).json();
    const other = await mk("CUSTOMER", "Other");
    await as(other);
    expect((await call("cancel", `/api/orders/${data.id}/cancel`, undefined, data.id)).status).toBe(404);
    await as(giri);
    expect((await call("cancel", `/api/orders/${data.id}/cancel`, undefined, data.id)).status).toBe(403);
    await as(ramu);
    expect((await call("cancel", `/api/orders/${data.id}/cancel`, undefined, data.id)).status).toBe(200);
    const [o] = await db.select().from(schema.orders).where(eq(schema.orders.id, data.id));
    expect(o.status).toBe("CANCELLED");
    expect(o.cancelledAt).toBeTruthy();
    const again = await call("cancel", `/api/orders/${data.id}/cancel`, undefined, data.id);
    expect(again.status).toBe(409);
  });
  it("cannot cancel once UNDER_REVIEW", async () => {
    await as(ramu);
    const { data } = await (await call("create", "/api/orders", body(giri.id, "3"))).json();
    await db.update(schema.orders).set({ status: "UNDER_REVIEW" }).where(eq(schema.orders.id, data.id));
    expect((await call("cancel", `/api/orders/${data.id}/cancel`, undefined, data.id)).status).toBe(409);
  });
  it("cancel still works after the distributor link was revoked", async () => {
    await as(ramu);
    const { data } = await (await call("create", "/api/orders", body(giri.id, "3"))).json();
    await db.update(schema.links).set({ status: "REVOKED", revokedBy: giri.id }).where(eq(schema.links.upperId, giri.id));
    expect((await call("cancel", `/api/orders/${data.id}/cancel`, undefined, data.id)).status).toBe(200);
    await db.update(schema.links).set({ status: "ACTIVE", revokedBy: null }).where(eq(schema.links.upperId, giri.id));
  });
});

describe("reads and isolation", () => {
  it("customer sees only own orders; distributor sees its own orders; strangers 404; invalid id 400", async () => {
    const c2 = await mk("CUSTOMER", "Ramu2");
    const g2 = await mk("DISTRIBUTOR", "Giri2");
    await link(giri, c2);
    await as(c2);
    const mine = await (await call("create", "/api/orders", body(giri.id, "2"))).json();
    await as(ramu);
    const list = await (await call("list", "/api/orders?limit=50")).json();
    expect(list.data.every((o: { id: string }) => o.id !== mine.data.id)).toBe(true);
    expect((await call("one", `/api/orders/${mine.data.id}`, undefined, mine.data.id)).status).toBe(404);
    await as(giri);
    const gl = await (await call("list", "/api/orders?limit=50")).json();
    expect(gl.data.some((o: { id: string }) => o.id === mine.data.id)).toBe(true);
    const d = await (await call("one", `/api/orders/${mine.data.id}`, undefined, mine.data.id)).json();
    expect(d.data.customer.name).toBeTruthy();
    await as(g2);
    expect((await call("one", `/api/orders/${mine.data.id}`, undefined, mine.data.id)).status).toBe(404);
    expect((await (await call("list", "/api/orders")).json()).data).toHaveLength(0);
    await as(anjani);
    expect((await call("list", "/api/orders")).status).toBe(403);
    await as(ramu);
    expect((await call("one", "/api/orders/x%20y", undefined, "x y")).status).toBe(400);
  });
  it("status filter and pagination cap", async () => {
    await as(ramu);
    const c = await (await call("list", "/api/orders?status=CANCELLED")).json();
    expect(c.data.length).toBeGreaterThan(0);
    expect(c.data.every((o: { status: string }) => o.status === "CANCELLED")).toBe(true);
    expect((await call("list", "/api/orders?limit=51")).status).toBe(400);
    expect((await call("list", "/api/orders?status=BOGUS")).status).toBe(400);
  });
});
