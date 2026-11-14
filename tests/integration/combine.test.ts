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
const dir = mkdtempSync(path.join(tmpdir(), "cl-combine-"));
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
const setProvider = async (poId: string, provider: U) => {
  await as(giri);
  const v = (await poRow(poId)).version;
  expect((await call("editPo", `/api/pos/${poId}`, "PATCH", { version: v, providerId: provider.id }, poId)).status).toBe(200);
};

describe("combine (S4)", () => {
  it("combines two Anjani drafts from two orders, places, and keeps customers and providers isolated", async () => {
    const a = await order(ramu, "4", [{ providerId: anjani.id, qtyTonnes: "4" }], "Ramu Site 1");
    const b = await order(sita, "3", [{ providerId: anjani.id, qtyTonnes: "3" }], "Sita Site 9");
    await open(a);
    await open(b);
    const [da] = await drafts(a);
    const [dbb] = await drafts(b);
    await as(giri);
    await call("editPo", `/api/pos/${da.id}`, "PATCH", { version: da.version, ratePerTonne: "6100" }, da.id);
    const cur = await poRow(da.id);
    const r = await combine([{ id: da.id, version: cur.version }, { id: dbb.id, version: dbb.version }]);
    expect(r.status).toBe(200);
    const { poId, version } = (await r.json()).data;
    expect(poId).toBe(da.id);
    expect((await itemsOf(poId)).map((i) => [i.order_id, i.qty_kg])).toEqual([[a, 4000], [b, 3000]]);
    expect(await db.all(sql`SELECT 1 FROM purchase_orders WHERE id = ${dbb.id}`)).toHaveLength(0);
    expect((await poRow(poId)).version).toBe(version);

    expect((await place([{ id: poId, version }])).status).toBe(200);
    expect((await db.all<{ status: string }>(sql`SELECT status FROM orders WHERE id IN (${a}, ${b})`)).map((o) => o.status)).toEqual(["POS_PLACED", "POS_PLACED"]);

    await as(ramu);
    const mine = await (await call("po", `/api/pos/${poId}`, "GET", undefined, poId)).json();
    expect(mine.data.items).toHaveLength(1);
    expect(mine.data).toMatchObject({ qtyKg: 4000, ratePerTonnePaise: null, totalPaise: null, version: null });
    const raw = JSON.stringify(mine.data);
    expect(raw).not.toContain("Sita");
    expect(raw).not.toContain(sita.id);
    expect(raw).not.toContain("Sita Site 9");
    expect(raw).not.toContain(b);
    const mineList = JSON.stringify(await (await call("pos", "/api/pos", "GET")).json());
    expect(mineList).not.toContain("Sita Site 9");
    await as(sita);
    const hers = await (await call("po", `/api/pos/${poId}`, "GET", undefined, poId)).json();
    expect(hers.data.qtyKg).toBe(3000);
    expect(JSON.stringify(hers.data)).not.toContain("Ramu Site 1");

    await as(anjani);
    const prov = await (await call("po", `/api/pos/${poId}`, "GET", undefined, poId)).json();
    expect(prov.data.items).toHaveLength(2);
    const addr = Object.fromEntries(prov.data.items.map((i: { orderId: string; address: string }) => [i.orderId, i.address]));
    expect(addr).toEqual({ [a]: "Ramu Site 1", [b]: "Sita Site 9" });
    expect(prov.data).toMatchObject({ qtyKg: 7000, totalPaise: 4270000 });
  });

  it("merges same-order items and leaves coverage unchanged", async () => {
    const id = await order(ramu, "15");
    await open(id);
    const [d] = await drafts(id);
    await as(giri);
    const s = await (await call("split", `/api/po-items/${d.item_id}/split`, "POST", { version: d.version, qtyTonnes: "5", providerId: anjani.id }, d.item_id)).json();
    await setProvider(d.id, anjani);
    const [x, y] = [await poRow(d.id), await poRow(s.data.poId)];
    const r = await combine([{ id: d.id, version: x.version }, { id: s.data.poId, version: y.version }]);
    expect(r.status).toBe(200);
    const left = await drafts(id);
    expect(left.map((l) => [l.qty_kg, l.provider_id])).toEqual([[15000, anjani.id]]);
    expect(await itemsOf(d.id)).toHaveLength(1);
  });

  it("rejects different providers, a NULL provider, another distributor's PO, non-DRAFT, and extra keys", async () => {
    const a = await order(ramu, "2", [{ providerId: anjani.id, qtyTonnes: "2" }]);
    const b = await order(sita, "2", [{ providerId: ambuja.id, qtyTonnes: "2" }]);
    const c = await order(sita, "2");
    const d2 = await order(ramu, "2", [{ providerId: anjani.id, qtyTonnes: "2" }]);
    for (const o of [a, b, c, d2]) await open(o);
    const [pa] = await drafts(a); const [pb] = await drafts(b); const [pc] = await drafts(c); const [pd] = await drafts(d2);
    const diff = await combine(pick([pa, pb]));
    expect(diff.status).toBe(422);
    expect((await diff.json()).code).toBe("NOT_COMBINABLE");
    expect((await (await combine(pick([pc, pc === pa ? pb : pa]))).json()).code).toBe("NOT_COMBINABLE");
    expect((await combine(pick([pa, pd]), other)).status).toBe(422);
    expect((await combine(pick([pa, pd]), ramu)).status).toBe(403);
    expect((await combine([{ id: pa.id, version: 0 }, { id: "nope", version: 0 }])).status).toBe(422);
    expect((await call("combine", "/api/pos/combine", "POST", { pos: [{ id: pa.id, version: 0 }] })).status).toBe(400);
    expect((await call("combine", "/api/pos/combine", "POST", { pos: [{ id: pa.id, version: 0 }, { id: pa.id, version: 0 }] })).status).toBe(400);
    expect((await call("combine", "/api/pos/combine", "POST", { pos: Array.from({ length: 21 }, (_, i) => ({ id: `p${i}`, version: 0 })) })).status).toBe(400);
    expect((await call("combine", "/api/pos/combine", "POST", { pos: pick([pa, pd]), x: 1 })).status).toBe(400);
    expect((await place(pick([pa]))).status).toBe(200);
    const placed = await combine(pick([{ ...pa, version: pa.version + 1 }, pd]));
    expect(placed.status).toBe(422);
    expect(await drafts(d2)).toHaveLength(1);
  });

  it("a changed version is 409 STALE and nothing moves; concurrent combines have one winner", async () => {
    const a = await order(ramu, "2", [{ providerId: anjani.id, qtyTonnes: "2" }]);
    const b = await order(sita, "2", [{ providerId: anjani.id, qtyTonnes: "2" }]);
    await open(a);
    await open(b);
    const [pa] = await drafts(a); const [pb] = await drafts(b);
    await as(giri);
    await call("editPo", `/api/pos/${pb.id}`, "PATCH", { version: pb.version, ratePerTonne: "6000" }, pb.id);
    const stale = await combine(pick([pa, pb]));
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe("STALE");
    expect(await drafts(a)).toHaveLength(1);
    expect(await drafts(b)).toHaveLength(1);
    const fresh = [{ id: pa.id, version: pa.version }, { id: pb.id, version: pb.version + 1 }];
    await as(giri);
    const rs = await Promise.all([1, 2, 3].map(() => call("combine", "/api/pos/combine", "POST", { pos: fresh })));
    expect(rs.filter((r) => r.status === 200)).toHaveLength(1);
    expect(rs.filter((r) => r.status !== 200).every((r) => [409, 422].includes(r.status))).toBe(true);
    expect(await itemsOf(pa.id)).toHaveLength(2);
    const cov = await db.all<{ n: number }>(sql`SELECT SUM(qty_kg) AS n FROM po_items WHERE order_id IN (${a}, ${b})`);
    expect(Number(cov[0].n)).toBe(4000);
  });
});

describe("combine rates", () => {
  const two = async (rateA: string | null, rateB: string | null) => {
    const a = await order(ramu, "2", [{ providerId: anjani.id, qtyTonnes: "2" }]);
    const b = await order(sita, "2", [{ providerId: anjani.id, qtyTonnes: "2" }]);
    await open(a);
    await open(b);
    const [pa] = await drafts(a); const [pb] = await drafts(b);
    await as(giri);
    if (rateA) await call("editPo", `/api/pos/${pa.id}`, "PATCH", { version: pa.version, ratePerTonne: rateA }, pa.id);
    if (rateB) await call("editPo", `/api/pos/${pb.id}`, "PATCH", { version: pb.version, ratePerTonne: rateB }, pb.id);
    return [pa.id, pb.id] as const;
  };
  const ver = async (id: string) => ({ id, version: (await poRow(id)).version });

  it("carries the only non-null rate onto the target, whichever draft held it", async () => {
    const [x, y] = await two(null, "6000");
    const r = await combine([await ver(x), await ver(y)]);
    expect(r.status).toBe(200);
    expect((await poRow(x)).rate).toBe(600000);
  });
  it("keeps a rate shared by several drafts", async () => {
    const [x, y] = await two("6000", "6000");
    expect((await combine([await ver(x), await ver(y)])).status).toBe(200);
    expect((await poRow(x)).rate).toBe(600000);
  });
  it("different non-null rates are 422 NOT_COMBINABLE and nothing changes", async () => {
    const [x, y] = await two("6000", "6100");
    const r = await combine([await ver(x), await ver(y)]);
    expect(r.status).toBe(422);
    const j = await r.json();
    expect(j.code).toBe("NOT_COMBINABLE");
    expect(j.error).toBe("Drafts have different rates");
    expect(await itemsOf(x)).toHaveLength(1);
    expect(await db.all(sql`SELECT 1 FROM purchase_orders WHERE id = ${y}`)).toHaveLength(1);
  });
});

describe("split back (S4)", () => {
  async function combined() {
    const a = await order(ramu, "2", [{ providerId: anjani.id, qtyTonnes: "2" }]);
    const b = await order(sita, "5", [{ providerId: anjani.id, qtyTonnes: "5" }]);
    await open(a);
    await open(b);
    const [pa] = await drafts(a); const [pb] = await drafts(b);
    const r = await (await combine(pick([pa, pb]))).json();
    return { a, b, poId: r.data.poId as string, version: r.data.version as number };
  }
  const sb = (poId: string, body: unknown, who: U = giri) => as(who).then(() => call("splitBack", `/api/pos/${poId}/split-back`, "POST", body, poId));

  it("moves chosen items to a new DRAFT PO with the same provider and rate; coverage unchanged", async () => {
    const { a, b, poId, version } = await combined();
    const items = await itemsOf(poId);
    const bItem = items.find((i) => i.order_id === b)!;
    const r = await sb(poId, { version, itemIds: [bItem.id] });
    expect(r.status).toBe(201);
    const j = (await r.json()).data;
    expect(j).toMatchObject({ version: 0, sourcePoId: poId, sourceVersion: version + 1 });
    expect(await poRow(j.poId)).toMatchObject({ status: "DRAFT", provider_id: anjani.id, version: 0 });
    expect((await itemsOf(poId)).map((i) => i.order_id)).toEqual([a]);
    expect((await itemsOf(j.poId)).map((i) => [i.order_id, i.qty_kg])).toEqual([[b, 5000]]);
    expect((await poRow(poId)).version).toBe(version + 1);
  });

  it("validates: one item must stay, items must belong, no duplicates, stale 409, foreign 404, placed 409", async () => {
    const { poId, version } = await combined();
    const items = await itemsOf(poId);
    expect((await sb(poId, { version, itemIds: items.map((i) => i.id) })).status).toBe(422);
    expect((await sb(poId, { version, itemIds: ["nope"] })).status).toBe(422);
    expect((await sb(poId, { version, itemIds: [items[0].id, items[0].id] })).status).toBe(400);
    expect((await sb(poId, { version, itemIds: [] })).status).toBe(400);
    expect((await sb(poId, { version, itemIds: [items[0].id], x: 1 })).status).toBe(400);
    expect((await sb(poId, { version: version + 5, itemIds: [items[0].id] })).status).toBe(409);
    expect((await sb(poId, { version, itemIds: [items[0].id] }, other)).status).toBe(404);
    expect((await sb(poId, { version, itemIds: [items[0].id] }, ramu)).status).toBe(403);
    expect(await itemsOf(poId)).toHaveLength(2);
    expect((await place([{ id: poId, version }])).status).toBe(200);
    const after = await sb(poId, { version: version + 1, itemIds: [items[0].id] });
    expect(after.status).toBe(409);
    expect(await itemsOf(poId)).toHaveLength(2);
  });
});
