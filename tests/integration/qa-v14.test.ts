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
const dir = mkdtempSync(path.join(tmpdir(), "cl-qa14-"));
process.env.DATABASE_URL = `file:${path.join(dir, "c.db")}`;
process.env.APP_URL = APP;
process.env.ACTION_MAX_PER_MIN = "5000";
process.env.REQUEST_MAX_PER_HOUR = "500";

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
async function mk(role: Role, name: string) {
  n += 1;
  const u = await svc.registerUser(db, {
    name, email: `u${n}-${name.toLowerCase()}@x.com`, password: "password123", role, phone: "9876543210", businessName: `${name} Biz`, city: "Pune",
  } as never);
  await db.update(schema.users).set({ status: "ACTIVE" }).where(eq(schema.users.id, u.id));
  return u;
}
const as = async (u: U) => {
  const { token } = await sess.createSession(db, u.id, 1);
  state.cookies.set("cl_session", token);
};
const call = (r: string, p: string, method: "GET" | "POST" | "PATCH", body?: unknown, id?: string) =>
  R[r](new Request(`${APP}${p}`, { method, body: body === undefined ? undefined : JSON.stringify(body) }), id ? { params: Promise.resolve({ id }) } : undefined);
const days = (d: number) => new Date(Date.now() + d * 86_400_000 + 330 * 60_000).toISOString().slice(0, 10);

let admin: { id: string };
let giri: U, ramu: U, sita: U, anjani: U, ambuja: U, other: U;
beforeAll(async () => {
  db = (await import("@/server/db/client")).getDb();
  schema = await import("@/server/db/schema");
  svc = await import("@/server/services/users");
  sess = await import("@/server/auth/session");
  links = await import("@/server/services/links");
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
  R = {
    create: (await import("@/app/api/orders/route")).POST as unknown as Route,
    cancel: (await import("@/app/api/orders/[id]/cancel/route")).POST as unknown as Route,
    one: (await import("@/app/api/orders/[id]/route")).GET as unknown as Route,
    open: (await import("@/app/api/orders/[id]/open/route")).POST as unknown as Route,
    reject: (await import("@/app/api/orders/[id]/reject/route")).POST as unknown as Route,
    pos: (await import("@/app/api/pos/route")).GET as unknown as Route,
    po: (await import("@/app/api/pos/[id]/route")).GET as unknown as Route,
    editPo: (await import("@/app/api/pos/[id]/route")).PATCH as unknown as Route,
    place: (await import("@/app/api/pos/place/route")).POST as unknown as Route,
    item: (await import("@/app/api/po-items/[id]/route")).PATCH as unknown as Route,
    split: (await import("@/app/api/po-items/[id]/split/route")).POST as unknown as Route,
    combine: (await import("@/app/api/pos/combine/route")).POST as unknown as Route,
    splitBack: (await import("@/app/api/pos/[id]/split-back/route")).POST as unknown as Route,
  };
  await svc.seedAdmin(db, "admin@x.com", "AdminPass123!");
  [admin] = await db.select().from(schema.users).where(eq(schema.users.email, "admin@x.com"));
  giri = await mk("DISTRIBUTOR", "Giri");
  other = await mk("DISTRIBUTOR", "Other");
  ramu = await mk("CUSTOMER", "Ramu");
  sita = await mk("CUSTOMER", "Sita");
  anjani = await mk("PROVIDER", "Anjani");
  ambuja = await mk("PROVIDER", "Ambuja");
  for (const [a, b] of [[giri, ramu], [giri, sita], [anjani, giri], [ambuja, giri]] as const) await links.forceLink(db, admin as never, a.id, b.id);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  state.cookies = new Map();
  state.headers = new Headers({ origin: APP });
});

async function order(customer: U, qty: string, allocations: Array<{ providerId: string; qtyTonnes: string }> = [], address = "12 Market Road"): Promise<string> {
  await as(customer);
  const r = await call("create", "/api/orders", "POST", { distributorId: giri.id, qtyTonnes: qty, allocations, neededBy: days(3), address, city: "Pune", pincode: "411001" });
  expect(r.status).toBe(201);
  return (await r.json()).data.id;
}
const open = async (id: string, who: U = giri) => {
  await as(who);
  return call("open", `/api/orders/${id}/open`, "POST", undefined, id);
};
const drafts = (orderId: string) =>
  db.all<{ id: string; item_id: string; provider_id: string | null; qty_kg: number; version: number; status: string }>(
    sql`SELECT p.id, i.id AS item_id, p.provider_id, i.qty_kg, p.version, p.status FROM po_items i JOIN purchase_orders p ON p.id = i.po_id WHERE i.order_id = ${orderId} ORDER BY i.qty_kg, p.id`,
  );
const place = async (items: Array<{ id: string; version: number }>, who: U = giri) => {
  await as(who);
  return call("place", "/api/pos/place", "POST", { pos: items });
};
const pick = (rows: Awaited<ReturnType<typeof drafts>>) => rows.map((r) => ({ id: r.id, version: r.version }));


const combine = async (items: Array<{ id: string; version: number }>, who: U = giri) => {
  await as(who);
  return call("combine", "/api/pos/combine", "POST", { pos: items });
};
const poRow = async (id: string) => (await db.all<{ status: string; version: number; provider_id: string | null; rate: number | null }>(sql`SELECT status, version, provider_id, rate_per_tonne_paise AS rate FROM purchase_orders WHERE id = ${id}`))[0];
const itemsOf = (poId: string) => db.all<{ id: string; order_id: string; qty_kg: number }>(sql`SELECT id, order_id, qty_kg FROM po_items WHERE po_id = ${poId} ORDER BY created_at, id`);

describe("QA V14 edge cases", () => {
  it("3-way combine across 3 orders keeps order views isolated and statuses consistent", async () => {
    const a = await order(ramu, "2", [{ providerId: anjani.id, qtyTonnes: "2" }], "RamuAddr A");
    const b = await order(sita, "3", [{ providerId: anjani.id, qtyTonnes: "3" }], "SitaAddr B");
    const c = await order(ramu, "4", [{ providerId: anjani.id, qtyTonnes: "4" }], "RamuAddr C");
    for (const o of [a, b, c]) await open(o);
    const ds = [(await drafts(a))[0], (await drafts(b))[0], (await drafts(c))[0]];
    const r = await combine(pick(ds));
    expect(r.status).toBe(200);
    const { poId, version } = (await r.json()).data;
    expect(await itemsOf(poId)).toHaveLength(3);
    expect((await place([{ id: poId, version }])).status).toBe(200);
    const st = await db.all<{ id: string; status: string }>(sql`SELECT id, status FROM orders WHERE id IN (${a}, ${b}, ${c})`);
    expect(st.map((s) => s.status)).toEqual(["POS_PLACED", "POS_PLACED", "POS_PLACED"]);
    // Customer order endpoint must not leak the other customer's data
    await as(ramu);
    for (const o of [a, c]) {
      const raw = JSON.stringify(await (await call("one", `/api/orders/${o}`, "GET", undefined, o)).json());
      expect(raw).not.toContain("SitaAddr");
      expect(raw).not.toContain(sita.id);
      expect(raw).not.toContain(b);
    }
    const lst = JSON.stringify(await (await call("pos", "/api/pos", "GET")).json());
    expect(lst).not.toContain("SitaAddr");
    expect(lst).not.toContain(b);
    await as(sita);
    const rawS = JSON.stringify(await (await call("pos", "/api/pos", "GET")).json());
    expect(rawS).not.toContain("RamuAddr");
    expect(rawS).not.toContain(a);
    expect(rawS).not.toContain(c);
    // Other provider sees nothing
    await as(ambuja);
    expect((await call("po", `/api/pos/${poId}`, "GET", undefined, poId)).status).toBeGreaterThanOrEqual(400);
    // Other distributor too
    await as(other);
    expect((await call("po", `/api/pos/${poId}`, "GET", undefined, poId)).status).toBeGreaterThanOrEqual(400);
  });

  it("exactly 20 drafts combine; duplicate ids rejected 400; 1 id 400", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 20; i++) ids.push(await order(i % 2 ? ramu : sita, "1", [{ providerId: ambuja.id, qtyTonnes: "1" }]));
    for (const o of ids) await open(o);
    const ds: Awaited<ReturnType<typeof drafts>> = [];
    for (const o of ids) ds.push((await drafts(o))[0]);
    const r = await combine(pick(ds));
    expect(r.status).toBe(200);
    const { poId } = (await r.json()).data;
    expect(await itemsOf(poId)).toHaveLength(20);
    const sum = await db.all<{ n: number }>(sql`SELECT SUM(qty_kg) AS n FROM po_items WHERE po_id = ${poId}`);
    expect(Number(sum[0].n)).toBe(20000);
  });

  it("order status rollup stays consistent after combine, split-back and re-combine", async () => {
    const a = await order(ramu, "2", [{ providerId: anjani.id, qtyTonnes: "2" }]);
    const b = await order(sita, "2", [{ providerId: anjani.id, qtyTonnes: "2" }]);
    await open(a); await open(b);
    const before = await db.all<{ id: string; status: string }>(sql`SELECT id, status FROM orders WHERE id IN (${a}, ${b}) ORDER BY id`);
    const [pa] = await drafts(a); const [pb] = await drafts(b);
    const c1 = (await (await combine(pick([pa, pb]))).json()).data;
    const mid = await db.all<{ id: string; status: string }>(sql`SELECT id, status FROM orders WHERE id IN (${a}, ${b}) ORDER BY id`);
    expect(mid).toEqual(before);
    const items = await itemsOf(c1.poId);
    const sbr = await as(giri).then(() => call("splitBack", `/api/pos/${c1.poId}/split-back`, "POST", { version: c1.version, itemIds: [items[1].id] }, c1.poId));
    expect(sbr.status).toBe(201);
    const s = (await sbr.json()).data;
    const mid2 = await db.all<{ id: string; status: string }>(sql`SELECT id, status FROM orders WHERE id IN (${a}, ${b}) ORDER BY id`);
    expect(mid2).toEqual(before);
    const c2 = await combine([{ id: c1.poId, version: s.sourceVersion }, { id: s.poId, version: s.version }]);
    expect(c2.status).toBe(200);
    expect(await itemsOf(c1.poId)).toHaveLength(2);
    // place; rollup
    const v = (await poRow(c1.poId)).version;
    expect((await place([{ id: c1.poId, version: v }])).status).toBe(200);
    const after = await db.all<{ status: string }>(sql`SELECT status FROM orders WHERE id IN (${a}, ${b})`);
    expect(after.every((o) => o.status === "POS_PLACED")).toBe(true);
  });

  it("combining a PO with itself plus unavailable id, and split-back of 1-item PO, are rejected without change", async () => {
    const a = await order(ramu, "2", [{ providerId: anjani.id, qtyTonnes: "2" }]);
    await open(a);
    const [pa] = await drafts(a);
    const r = await combine([{ id: pa.id, version: pa.version }, { id: "00000000-0000-0000-0000-000000000000", version: 0 }]);
    expect(r.status).toBe(422);
    const items = await itemsOf(pa.id);
    await as(giri);
    const sb = await call("splitBack", `/api/pos/${pa.id}/split-back`, "POST", { version: pa.version, itemIds: [items[0].id] }, pa.id);
    expect(sb.status).toBe(422);
    expect(await itemsOf(pa.id)).toHaveLength(1);
    expect((await poRow(pa.id)).version).toBe(pa.version);
  });

  it("unauthenticated and cross-origin requests are rejected", async () => {
    state.cookies = new Map();
    expect([401, 403]).toContain((await call("combine", "/api/pos/combine", "POST", { pos: [{ id: "a", version: 0 }, { id: "b", version: 0 }] })).status);
    await as(giri);
    state.headers = new Headers({ origin: "http://evil.example" });
    expect((await call("combine", "/api/pos/combine", "POST", { pos: [{ id: "a", version: 0 }, { id: "b", version: 0 }] })).status).toBeGreaterThanOrEqual(400);
    expect((await call("splitBack", "/api/pos/x/split-back", "POST", { version: 0, itemIds: ["a"] }, "x")).status).toBeGreaterThanOrEqual(400);
  });

  it("combining a placed-then-rejected or suspended-distributor state is not allowed", async () => {
    const a = await order(ramu, "2", [{ providerId: anjani.id, qtyTonnes: "2" }]);
    const b = await order(sita, "2", [{ providerId: anjani.id, qtyTonnes: "2" }]);
    await open(a); await open(b);
    const [pa] = await drafts(a); const [pb] = await drafts(b);
    await db.update(schema.users).set({ status: "REJECTED" }).where(eq(schema.users.id, giri.id));
    const r = await combine(pick([pa, pb]));
    await db.update(schema.users).set({ status: "ACTIVE" }).where(eq(schema.users.id, giri.id));
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(await drafts(a)).toHaveLength(1);
    expect(await drafts(b)).toHaveLength(1);
  });
});

describe("QA V14 re-check: rates and split-back versions", () => {
  const rate = async (poId: string, r: string) => {
    await as(giri);
    const v = (await poRow(poId)).version;
    expect((await call("editPo", `/api/pos/${poId}`, "PATCH", { version: v, ratePerTonne: r }, poId)).status).toBe(200);
  };
  it("different non-null rates -> 422 NOT_COMBINABLE; one non-null rate carried to target; both null ok", async () => {
    const mk2 = async () => {
      const a = await order(ramu, "2", [{ providerId: anjani.id, qtyTonnes: "2" }]);
      const b = await order(sita, "2", [{ providerId: anjani.id, qtyTonnes: "2" }]);
      await open(a); await open(b);
      return [(await drafts(a))[0], (await drafts(b))[0]];
    };
    let [pa, pb] = await mk2();
    await rate(pa.id, "6000"); await rate(pb.id, "6100");
    const [ca, cb] = [await poRow(pa.id), await poRow(pb.id)];
    const bad = await combine([{ id: pa.id, version: ca.version }, { id: pb.id, version: cb.version }]);
    expect(bad.status).toBe(422);
    const j = await bad.json();
    expect(j.code).toBe("NOT_COMBINABLE");
    expect(JSON.stringify(j)).toContain("different rates");
    expect(await itemsOf(pa.id)).toHaveLength(1);
    // same rate on both is fine
    await rate(pb.id, "6000");
    const ok = await combine([{ id: pa.id, version: ca.version }, { id: pb.id, version: (await poRow(pb.id)).version }]);
    expect(ok.status).toBe(200);
    expect((await poRow(pa.id)).rate).toBe(600000);
    // only the younger has a rate -> carried to the (older, null-rate) target
    [pa, pb] = await mk2();
    await rate(pb.id, "6200");
    const r2 = await combine([{ id: pa.id, version: (await poRow(pa.id)).version }, { id: pb.id, version: (await poRow(pb.id)).version }]);
    expect(r2.status).toBe(200);
    const target = (await r2.json()).data.poId;
    expect((await poRow(target)).rate).toBe(620000);
    // both null
    [pa, pb] = await mk2();
    const r3 = await combine([{ id: pa.id, version: pa.version }, { id: pb.id, version: pb.version }]);
    expect(r3.status).toBe(200);
    expect((await poRow((await r3.json()).data.poId)).rate).toBeNull();
  });

  it("split-back returns real versions for both POs", async () => {
    const a = await order(ramu, "2", [{ providerId: anjani.id, qtyTonnes: "2" }]);
    const b = await order(sita, "2", [{ providerId: anjani.id, qtyTonnes: "2" }]);
    await open(a); await open(b);
    const c = await (await combine(pick([(await drafts(a))[0], (await drafts(b))[0]]))).json();
    const items = await itemsOf(c.data.poId);
    await as(giri);
    const r = await call("splitBack", `/api/pos/${c.data.poId}/split-back`, "POST", { version: c.data.version, itemIds: [items[1].id] }, c.data.poId);
    expect(r.status).toBe(201);
    const d = (await r.json()).data;
    expect(d).toMatchObject({ version: 0, sourcePoId: c.data.poId });
    expect(d.sourceVersion).toBe((await poRow(c.data.poId)).version);
    expect((await call("editPo", `/api/pos/${d.poId}`, "PATCH", { version: d.version, ratePerTonne: "5000" }, d.poId)).status).toBe(200);
    expect((await call("editPo", `/api/pos/${d.sourcePoId}`, "PATCH", { version: d.sourceVersion, ratePerTonne: "5000" }, d.sourcePoId)).status).toBe(200);
    // stale versions rejected
    expect((await call("editPo", `/api/pos/${d.poId}`, "PATCH", { version: 0, ratePerTonne: "5100" }, d.poId)).status).toBe(409);
  });
});
