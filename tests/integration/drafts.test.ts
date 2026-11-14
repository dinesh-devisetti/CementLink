import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq, sql } from "drizzle-orm";
import { computeOrderStatus } from "@/server/domain/order-status";

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
const dir = mkdtempSync(path.join(tmpdir(), "cl-drafts-"));
process.env.DATABASE_URL = `file:${path.join(dir, "d.db")}`;
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

async function order(customer: U, qty: string, allocations: Array<{ providerId: string; qtyTonnes: string }> = []): Promise<string> {
  await as(customer);
  const r = await call("create", "/api/orders", "POST", { distributorId: giri.id, qtyTonnes: qty, allocations, neededBy: days(3), address: "12 Market Road", city: "Pune", pincode: "411001" });
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
const orderStatus = async (id: string) => (await db.all<{ status: string }>(sql`SELECT status FROM orders WHERE id = ${id}`))[0].status;
/** Stored order status must equal the status recomputed by domain/order-status.ts from the PO statuses. */
async function expectRollup(orderId: string, expected: string) {
  const stored = await orderStatus(orderId);
  const pos = await db.all<{ status: never }>(sql`SELECT p.status FROM po_items i JOIN purchase_orders p ON p.id = i.po_id WHERE i.order_id = ${orderId}`);
  expect(stored).toBe(expected);
  expect(computeOrderStatus(stored as never, pos.map((p) => p.status))).toBe(stored);
}
const place = async (items: Array<{ id: string; version: number }>, who: U = giri) => {
  await as(who);
  return call("place", "/api/pos/place", "POST", { pos: items });
};
const pick = (rows: Awaited<ReturnType<typeof drafts>>) => rows.map((r) => ({ id: r.id, version: r.version }));

describe("open: auto drafts (S4)", () => {
  it("Case 1: 30 t = Anjani 10 + Ambuja 20 gives 2 provider drafts and UNDER_REVIEW", async () => {
    const id = await order(ramu, "30", [{ providerId: anjani.id, qtyTonnes: "10" }, { providerId: ambuja.id, qtyTonnes: "20" }]);
    const r = await open(id);
    expect(r.status).toBe(200);
    expect((await r.json()).data.opened).toBe(true);
    const d = await drafts(id);
    expect(d.map((x) => [x.provider_id, x.qty_kg, x.status])).toEqual([[anjani.id, 10000, "DRAFT"], [ambuja.id, 20000, "DRAFT"]]);
    await expectRollup(id, "UNDER_REVIEW");
  });

  it("Case 2: 15 t no split gives one draft with no provider", async () => {
    const id = await order(ramu, "15");
    await open(id);
    const d = await drafts(id);
    expect(d.map((x) => [x.provider_id, x.qty_kg])).toEqual([[null, 15000]]);
  });

  it("double open and concurrent open create drafts exactly once", async () => {
    const id = await order(ramu, "8", [{ providerId: anjani.id, qtyTonnes: "3" }]);
    await as(giri);
    const rs = await Promise.all([1, 2, 3].map(() => call("open", `/api/orders/${id}/open`, "POST", undefined, id)));
    expect(rs.map((r) => r.status)).toEqual([200, 200, 200]);
    expect((await Promise.all(rs.map(async (r) => (await r.json()).data.opened))).filter(Boolean)).toHaveLength(1);
    expect(await drafts(id)).toHaveLength(2);
    expect((await (await open(id)).json()).data.opened).toBe(false);
    expect(await drafts(id)).toHaveLength(2);
  });

  it("cancel then open is 409; open then cancel is 409", async () => {
    const a = await order(ramu, "2");
    await as(ramu);
    expect((await call("cancel", `/api/orders/${a}/cancel`, "POST", undefined, a)).status).toBe(200);
    expect((await open(a)).status).toBe(409);
    expect(await drafts(a)).toHaveLength(0);
    const b = await order(ramu, "2");
    await open(b);
    await as(ramu);
    expect((await call("cancel", `/api/orders/${b}/cancel`, "POST", undefined, b)).status).toBe(409);
    await expectRollup(b, "UNDER_REVIEW");
  });

  it("cancel racing open (direct service calls) leaves exactly one winner and a consistent order", async () => {
    const drafting = await import("@/server/services/drafts");
    const orders = await import("@/server/services/orders");
    const [giriRow] = await db.select().from(schema.users).where(eq(schema.users.id, giri.id));
    const [ramuRow] = await db.select().from(schema.users).where(eq(schema.users.id, ramu.id));
    for (let i = 0; i < 5; i++) {
      const id = await order(ramu, "2", [{ providerId: anjani.id, qtyTonnes: "1" }]);
      const res = await Promise.allSettled([drafting.openOrder(db, giriRow, id), orders.cancelOrder(db, ramuRow, id)]);
      expect(res.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const st = await orderStatus(id);
      expect(["UNDER_REVIEW", "CANCELLED"]).toContain(st);
      expect((await drafts(id)).length).toBe(st === "UNDER_REVIEW" ? 2 : 0);
      if (st === "UNDER_REVIEW") await expectRollup(id, "UNDER_REVIEW");
    }
  });

  it("only the order's own distributor may open; customers and foreign Origin are refused", async () => {
    const id = await order(ramu, "2");
    expect((await open(id, other)).status).toBe(404);
    expect((await open(id, ramu)).status).toBe(403);
    expect((await open(id, anjani)).status).toBe(403);
    state.headers = new Headers({ origin: "http://evil.example" });
    expect((await open(id)).status).toBe(403);
    expect(await orderStatus(id)).toBe("REQUESTED");
  });
});

describe("place (S4 must-pass)", () => {
  it("Case 1: places both drafts, order -> POS_PLACED, provider sees its PO with Ramu's address", async () => {
    const id = await order(ramu, "30", [{ providerId: anjani.id, qtyTonnes: "10" }, { providerId: ambuja.id, qtyTonnes: "20" }]);
    await open(id);
    const d = await drafts(id);
    const r = await place(pick(d));
    expect(r.status).toBe(200);
    expect((await r.json()).data.placed).toBe(2);
    await expectRollup(id, "POS_PLACED");
    const after = await drafts(id);
    expect(after.map((x) => [x.status, x.qty_kg])).toEqual([["PLACED", 10000], ["PLACED", 20000]]);
    const frozen = await db.all<{ qty_kg: number; placed_at: number }>(sql`SELECT qty_kg, placed_at FROM purchase_orders WHERE id IN (${after[0].id}, ${after[1].id}) ORDER BY qty_kg`);
    expect(frozen.map((f) => f.qty_kg)).toEqual([10000, 20000]);
    expect(frozen[0].placed_at).toBeGreaterThan(0);

    await as(anjani);
    const list = await (await call("pos", "/api/pos", "GET")).json();
    const mine = list.data.filter((p: { items: Array<{ orderId: string }> }) => p.items.some((i) => i.orderId === id));
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ status: "PLACED", qtyKg: 10000 });
    expect(mine[0].items[0]).toMatchObject({ address: "12 Market Road", city: "Pune", pincode: "411001", customerName: expect.stringMatching(/^Unnamed customer \(#/) });
    expect(JSON.stringify(mine[0])).not.toMatch(/@x\.com|9876543210/);
    await as(ambuja);
    const l2 = await (await call("pos", "/api/pos", "GET")).json();
    expect(l2.data.find((p: { id: string }) => p.id === after[1].id)).toMatchObject({ status: "PLACED", qtyKg: 20000 });
  });

  it("Case 2: Giri picks Ambuja for the 15 t draft and places it", async () => {
    const id = await order(ramu, "15");
    await open(id);
    const [d] = await drafts(id);
    await as(giri);
    const e = await call("editPo", `/api/pos/${d.id}`, "PATCH", { version: d.version, providerId: ambuja.id }, d.id);
    expect(e.status).toBe(200);
    const v = (await e.json()).data.version;
    expect((await place([{ id: d.id, version: v }])).status).toBe(200);
    await expectRollup(id, "POS_PLACED");
    await as(ambuja);
    const got = await (await call("po", `/api/pos/${d.id}`, "GET", undefined, d.id)).json();
    expect(got.data).toMatchObject({ status: "PLACED", qtyKg: 15000, providerId: ambuja.id });
  });

  it("is blocked on a NULL provider and on coverage mismatch, leaving everything unchanged", async () => {
    const id = await order(ramu, "15");
    await open(id);
    const [d] = await drafts(id);
    let r = await place([{ id: d.id, version: d.version }]);
    expect(r.status).toBe(422);
    expect((await r.json()).code).toBe("NO_PROVIDER");

    await as(giri);
    const e = await (await call("editPo", `/api/pos/${d.id}`, "PATCH", { version: d.version, providerId: anjani.id }, d.id)).json();
    const it2 = await call("item", `/api/po-items/${d.item_id}`, "PATCH", { version: e.data.version, qtyTonnes: "14" }, d.item_id);
    expect(it2.status).toBe(200);
    const [cur] = await drafts(id);
    r = await place([{ id: cur.id, version: cur.version }]);
    expect(r.status).toBe(422);
    const j = await r.json();
    expect(j.code).toBe("QTY_MISMATCH");
    expect(j.error).toMatch(/needs 15 t, drafts total 14 t/);
    expect((await drafts(id))[0].status).toBe("DRAFT");
    await expectRollup(id, "UNDER_REVIEW");
  });

  it("a stale version is 409 STALE and nothing is placed", async () => {
    const id = await order(ramu, "4", [{ providerId: anjani.id, qtyTonnes: "4" }]);
    await open(id);
    const [d] = await drafts(id);
    await as(giri);
    await call("editPo", `/api/pos/${d.id}`, "PATCH", { version: d.version, ratePerTonne: "6200" }, d.id);
    const stale = await call("editPo", `/api/pos/${d.id}`, "PATCH", { version: d.version, ratePerTonne: "6300" }, d.id);
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe("STALE");
    const r = await place([{ id: d.id, version: d.version }]);
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe("STALE");
    expect((await drafts(id))[0].status).toBe("DRAFT");
  });

  it("freezes qty and computes the total from the optional rate; placing twice is refused", async () => {
    const id = await order(ramu, "2.5", [{ providerId: anjani.id, qtyTonnes: "2.5" }]);
    await open(id);
    const [d] = await drafts(id);
    await as(giri);
    const e = await (await call("editPo", `/api/pos/${d.id}`, "PATCH", { version: d.version, ratePerTonne: "6200.50" }, d.id)).json();
    expect((await place([{ id: d.id, version: e.data.version }])).status).toBe(200);
    const [po] = await db.all<{ qty_kg: number; rate: number; total: number }>(sql`SELECT qty_kg, rate_per_tonne_paise AS rate, total_paise AS total FROM purchase_orders WHERE id = ${d.id}`);
    expect(po).toEqual({ qty_kg: 2500, rate: 620050, total: 1550125 });
    const again = await place([{ id: d.id, version: e.data.version + 1 }]);
    expect(again.status).toBe(409);
  });

  it("is blocked while the provider link is revoked, and works once it is active again", async () => {
    const id = await order(ramu, "3", [{ providerId: ambuja.id, qtyTonnes: "3" }]);
    await open(id);
    const [d] = await drafts(id);
    await db.update(schema.links).set({ status: "REVOKED", revokedBy: giri.id }).where(eq(schema.links.upperId, ambuja.id));
    const r = await place([{ id: d.id, version: d.version }]);
    expect(r.status).toBe(422);
    expect((await r.json()).code).toBe("PROVIDER_NOT_LINKED");
    await db.update(schema.links).set({ status: "ACTIVE", revokedBy: null }).where(eq(schema.links.upperId, ambuja.id));
    expect((await place([{ id: d.id, version: d.version }])).status).toBe(200);
  });

  it("validates the body: max 20, no duplicates, strict keys, foreign POs are 404", async () => {
    await as(giri);
    const many = Array.from({ length: 21 }, (_, i) => ({ id: `p${i}`, version: 0 }));
    expect((await call("place", "/api/pos/place", "POST", { pos: many })).status).toBe(400);
    expect((await call("place", "/api/pos/place", "POST", { pos: [] })).status).toBe(400);
    expect((await call("place", "/api/pos/place", "POST", { pos: [{ id: "a", version: 0 }, { id: "a", version: 0 }] })).status).toBe(400);
    expect((await call("place", "/api/pos/place", "POST", { pos: [{ id: "a", version: 0, x: 1 }] })).status).toBe(400);
    expect((await call("place", "/api/pos/place", "POST", { pos: [{ id: "nope", version: 0 }] })).status).toBe(404);
    const id = await order(ramu, "1", [{ providerId: anjani.id, qtyTonnes: "1" }]);
    await open(id);
    const [d] = await drafts(id);
    expect((await place([{ id: d.id, version: d.version }], other)).status).toBe(404);
    expect((await place([{ id: d.id, version: d.version }], ramu)).status).toBe(403);
  });
});

describe("edits and split", () => {
  it("split moves part of an item into a new draft, keeps coverage, and both place together", async () => {
    const id = await order(ramu, "15");
    await open(id);
    const [d] = await drafts(id);
    await as(giri);
    const s = await call("split", `/api/po-items/${d.item_id}/split`, "POST", { version: d.version, qtyTonnes: "5", providerId: anjani.id }, d.item_id);
    expect(s.status).toBe(201);
    const rows = await drafts(id);
    expect(rows.map((r) => [r.qty_kg, r.provider_id])).toEqual([[5000, anjani.id], [10000, null]]);
    const stale = await call("split", `/api/po-items/${d.item_id}/split`, "POST", { version: d.version, qtyTonnes: "1", providerId: null }, d.item_id);
    expect(stale.status).toBe(409);
    const big = await call("split", `/api/po-items/${d.item_id}/split`, "POST", { version: rows[1].version, qtyTonnes: "10", providerId: null }, d.item_id);
    expect(big.status).toBe(422);
    const e = await (await call("editPo", `/api/pos/${rows[1].id}`, "PATCH", { version: rows[1].version, providerId: ambuja.id }, rows[1].id)).json();
    const cur = await drafts(id);
    const r = await place([{ id: cur[0].id, version: cur[0].version }, { id: rows[1].id, version: e.data.version }]);
    expect(r.status).toBe(200);
    await expectRollup(id, "POS_PLACED");
  });

  it("placing one of two drafts keeps the order UNDER_REVIEW; placing the rest rolls it up", async () => {
    const id = await order(ramu, "6", [{ providerId: anjani.id, qtyTonnes: "2" }, { providerId: ambuja.id, qtyTonnes: "4" }]);
    await open(id);
    const d = await drafts(id);
    expect((await place([{ id: d[0].id, version: d[0].version }])).status).toBe(200);
    await expectRollup(id, "UNDER_REVIEW");
    const rest = (await drafts(id)).filter((r) => r.status === "DRAFT");
    expect((await place(pick(rest))).status).toBe(200);
    await expectRollup(id, "POS_PLACED");
  });

  it("rejects bad input: extra keys, empty patch, bad tonnes and rate, foreign draft", async () => {
    const id = await order(ramu, "2", [{ providerId: anjani.id, qtyTonnes: "2" }]);
    await open(id);
    const [d] = await drafts(id);
    await as(giri);
    const patch = (b: unknown) => call("editPo", `/api/pos/${d.id}`, "PATCH", b, d.id);
    expect((await patch({ version: d.version })).status).toBe(400);
    expect((await patch({ version: d.version, providerId: anjani.id, extra: 1 })).status).toBe(400);
    expect((await patch({ version: d.version, ratePerTonne: "0" })).status).toBe(400);
    expect((await patch({ version: d.version, ratePerTonne: "12.345" })).status).toBe(400);
    expect((await patch({ version: d.version, providerId: sita.id })).status).toBe(422);
    expect((await call("item", `/api/po-items/${d.item_id}`, "PATCH", { version: d.version, qtyTonnes: "1.2345" }, d.item_id)).status).toBe(400);
    await as(other);
    expect((await patch({ version: d.version, ratePerTonne: "5" })).status).toBe(404);
    expect((await call("item", `/api/po-items/${d.item_id}`, "PATCH", { version: d.version, qtyTonnes: "1" }, d.item_id)).status).toBe(404);
  });

  it("a placed PO can no longer be edited", async () => {
    const id = await order(ramu, "2", [{ providerId: anjani.id, qtyTonnes: "2" }]);
    await open(id);
    const [d] = await drafts(id);
    await place([{ id: d.id, version: d.version }]);
    const [p] = await drafts(id);
    const r = await call("editPo", `/api/pos/${d.id}`, "PATCH", { version: p.version, ratePerTonne: "5" }, d.id);
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe("INVALID_STATE");
  });
});

describe("fix loop 1 edge cases", () => {
  it("split to an unlinked provider is 422 and changes nothing", async () => {
    const loner = await mk("PROVIDER", "Loner");
    const id = await order(ramu, "6");
    await open(id);
    const [d] = await drafts(id);
    await as(giri);
    const r = await call("split", `/api/po-items/${d.item_id}/split`, "POST", { version: d.version, qtyTonnes: "2", providerId: loner.id }, d.item_id);
    expect(r.status).toBe(422);
    expect((await r.json()).code).toBe("PROVIDER_NOT_LINKED");
    expect(await drafts(id)).toHaveLength(1);
  });

  it("an edit with a version from before the order was rejected is 404 (draft gone) or STALE (draft shared)", async () => {
    const a = await order(ramu, "4", [{ providerId: anjani.id, qtyTonnes: "4" }]);
    await open(a);
    const [da] = await drafts(a);
    await as(giri);
    expect((await call("reject", `/api/orders/${a}/reject`, "POST", { reason: "No stock" }, a)).status).toBe(200);
    const gone = await call("editPo", `/api/pos/${da.id}`, "PATCH", { version: da.version, ratePerTonne: "5" }, da.id);
    expect(gone.status).toBe(404);

    const b = await order(ramu, "4", [{ providerId: anjani.id, qtyTonnes: "4" }]);
    const c = await order(sita, "3", [{ providerId: anjani.id, qtyTonnes: "3" }]);
    await open(b);
    await open(c);
    const [db1] = await drafts(b);
    const [dc] = await drafts(c);
    await db.run(sql`UPDATE po_items SET po_id = ${db1.id} WHERE id = ${dc.item_id}`);
    await db.run(sql`DELETE FROM purchase_orders WHERE id = ${dc.id}`);
    await as(giri);
    expect((await call("reject", `/api/orders/${c}/reject`, "POST", { reason: "No stock" }, c)).status).toBe(200);
    const stale = await call("editPo", `/api/pos/${db1.id}`, "PATCH", { version: db1.version, ratePerTonne: "5" }, db1.id);
    expect(stale.status).toBe(409);
    expect((await stale.json()).code).toBe("STALE");
    expect(await drafts(b)).toHaveLength(1);
  });

  it("clearing the provider with null then placing gives NO_PROVIDER", async () => {
    const id = await order(ramu, "2", [{ providerId: anjani.id, qtyTonnes: "2" }]);
    await open(id);
    const [d] = await drafts(id);
    await as(giri);
    const e = await (await call("editPo", `/api/pos/${d.id}`, "PATCH", { version: d.version, providerId: null }, d.id)).json();
    const r = await place([{ id: d.id, version: e.data.version }]);
    expect(r.status).toBe(422);
    expect((await r.json()).code).toBe("NO_PROVIDER");
  });

  it("editing an item of a placed PO is 409, and re-opening a placed order is a no-op", async () => {
    const id = await order(ramu, "2", [{ providerId: anjani.id, qtyTonnes: "2" }]);
    await open(id);
    const [d] = await drafts(id);
    await place([{ id: d.id, version: d.version }]);
    const [p] = await drafts(id);
    await as(giri);
    const r = await call("item", `/api/po-items/${d.item_id}`, "PATCH", { version: p.version, qtyTonnes: "1" }, d.item_id);
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe("INVALID_STATE");
    expect((await (await open(id)).json()).data.opened).toBe(false);
    await expectRollup(id, "POS_PLACED");
  });
});

describe("reject order", () => {
  it("rejects while UNDER_REVIEW, removing its drafts, but not once a PO is placed", async () => {
    const id = await order(ramu, "6", [{ providerId: anjani.id, qtyTonnes: "2" }, { providerId: ambuja.id, qtyTonnes: "4" }]);
    await open(id);
    await as(giri);
    expect((await call("reject", `/api/orders/${id}/reject`, "POST", { reason: "" }, id)).status).toBe(400);
    expect((await call("reject", `/api/orders/${id}/reject`, "POST", { reason: "Out of stock", x: 1 }, id)).status).toBe(400);
    const d = await drafts(id);
    await place([{ id: d[0].id, version: d[0].version }]);
    expect((await call("reject", `/api/orders/${id}/reject`, "POST", { reason: "Nope" }, id)).status).toBe(409);

    const free = await order(ramu, "6", [{ providerId: anjani.id, qtyTonnes: "2" }]);
    await open(free);
    await as(giri);
    expect((await call("reject", `/api/orders/${free}/reject`, "POST", { reason: "Out of stock" }, free)).status).toBe(200);
    expect(await drafts(free)).toHaveLength(0);
    expect(await orderStatus(free)).toBe("REJECTED");
    const [row] = await db.all<{ reject_reason: string }>(sql`SELECT reject_reason FROM orders WHERE id = ${free}`);
    expect(row.reject_reason).toBe("Out of stock");
    expect((await open(free)).status).toBe(409);
  });

  it("a REQUESTED order can be rejected directly", async () => {
    const id = await order(ramu, "1");
    await as(giri);
    expect((await call("reject", `/api/orders/${id}/reject`, "POST", { reason: "No capacity" }, id)).status).toBe(200);
    expect(await orderStatus(id)).toBe("REJECTED");
  });
});

describe("visibility", () => {
  it("providers never see DRAFT POs; customers see only their own items and no rates", async () => {
    const a = await order(ramu, "4", [{ providerId: anjani.id, qtyTonnes: "4" }]);
    const b = await order(sita, "3", [{ providerId: anjani.id, qtyTonnes: "3" }]);
    await open(a);
    await open(b);
    const [da] = await drafts(a);
    const [dbb] = await drafts(b);
    await as(anjani);
    expect((await call("po", `/api/pos/${da.id}`, "GET", undefined, da.id)).status).toBe(404);
    const l = await (await call("pos", "/api/pos", "GET")).json();
    expect(l.data.some((p: { id: string }) => p.id === da.id)).toBe(false);

    // Simulate a combined PO (V14): Sita's item inside Ramu's PO, then place it.
    await db.run(sql`UPDATE po_items SET po_id = ${da.id} WHERE id = ${dbb.item_id}`);
    await db.run(sql`DELETE FROM purchase_orders WHERE id = ${dbb.id}`);
    await db.run(sql`UPDATE purchase_orders SET rate_per_tonne_paise = 6200 WHERE id = ${da.id}`);
    const [cur] = await drafts(a);
    expect((await place([{ id: da.id, version: cur.version }])).status).toBe(200);

    await as(ramu);
    const mine = await (await call("po", `/api/pos/${da.id}`, "GET", undefined, da.id)).json();
    expect(mine.data.items).toHaveLength(1);
    expect(mine.data).toMatchObject({ status: "PLACED", qtyKg: 4000, providerName: "Anjani Biz", ratePerTonnePaise: null, totalPaise: null, version: null });
    expect(JSON.stringify(mine.data)).not.toContain(sita.id);
    expect(JSON.stringify(mine.data)).not.toContain("Sita");
    await as(sita);
    const hers = await (await call("po", `/api/pos/${da.id}`, "GET", undefined, da.id)).json();
    expect(hers.data.qtyKg).toBe(3000);
    expect(hers.data.items[0].orderId).toBe(b);
    await as(other);
    expect((await call("po", `/api/pos/${da.id}`, "GET", undefined, da.id)).status).toBe(404);
    await as(ambuja);
    expect((await call("po", `/api/pos/${da.id}`, "GET", undefined, da.id)).status).toBe(404);
    await as(ramu);
    const od = await (await call("one", `/api/orders/${a}`, "GET", undefined, a)).json();
    expect(od.data.pos).toEqual([{ poId: da.id, status: "PLACED", providerName: "Anjani Biz", qtyKg: 4000, dispatchDate: null, vehicleNo: null }]);
  });

  it("customers see no drafts in the order document chain; the distributor does", async () => {
    const id = await order(ramu, "5");
    await open(id);
    await as(ramu);
    expect((await (await call("one", `/api/orders/${id}`, "GET", undefined, id)).json()).data.pos).toEqual([]);
    await as(giri);
    const od = (await (await call("one", `/api/orders/${id}`, "GET", undefined, id)).json()).data;
    expect(od.pos).toEqual([{ poId: expect.any(String), status: "DRAFT", providerName: null, qtyKg: 5000, dispatchDate: null, vehicleNo: null }]);
    const l = await (await call("pos", `/api/pos?status=DRAFT&orderId=${id}`, "GET")).json();
    expect(l.data).toHaveLength(1);
    expect(l.data[0].items[0]).toMatchObject({ orderQtyKg: 5000, orderCoverageKg: 5000, customerName: "Ramu" });
  });
});
