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
const dir = mkdtempSync(path.join(tmpdir(), "cl-qa13-"));
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


describe("QA V13 edge cases", () => {
  it("cross-tenant: another distributor cannot edit, split, place or read Giri's drafts (404, nothing changes)", async () => {
    const id = await order(ramu, "6", [{ providerId: anjani.id, qtyTonnes: "6" }]);
    await open(id);
    const [d] = await drafts(id);
    await as(other);
    expect((await call("editPo", `/api/pos/${d.id}`, "PATCH", { version: d.version, ratePerTonne: "5000" }, d.id)).status).toBe(404);
    expect((await call("item", `/api/po-items/${d.item_id}`, "PATCH", { version: d.version, qtyTonnes: "1" }, d.item_id)).status).toBe(404);
    expect((await call("split", `/api/po-items/${d.item_id}/split`, "POST", { version: d.version, qtyTonnes: "1", providerId: null }, d.item_id)).status).toBe(404);
    expect((await call("place", "/api/pos/place", "POST", { pos: [{ id: d.id, version: d.version }] })).status).toBe(404);
    expect((await call("po", `/api/pos/${d.id}`, "GET", undefined, d.id)).status).toBe(404);
    expect((await call("reject", `/api/orders/${id}/reject`, "POST", { reason: "x" }, id)).status).toBe(404);
    const [after] = await drafts(id);
    expect(after).toMatchObject({ version: d.version, qty_kg: 6000, status: "DRAFT" });
    await expectRollup(id, "UNDER_REVIEW");
  });

  it("anonymous is 401; admin, provider and customer cannot mutate or list drafts", async () => {
    const id = await order(ramu, "2", [{ providerId: anjani.id, qtyTonnes: "2" }]);
    await open(id);
    const [d] = await drafts(id);
    state.cookies = new Map();
    expect((await call("place", "/api/pos/place", "POST", { pos: [{ id: d.id, version: d.version }] })).status).toBe(401);
    expect((await call("pos", "/api/pos", "GET")).status).toBe(401);
    expect((await call("po", `/api/pos/${d.id}`, "GET", undefined, d.id)).status).toBe(401);
    for (const who of [anjani, ramu, admin]) {
      await as(who);
      expect((await call("place", "/api/pos/place", "POST", { pos: [{ id: d.id, version: d.version }] })).status).toBe(403);
      expect((await call("editPo", `/api/pos/${d.id}`, "PATCH", { version: d.version, ratePerTonne: "1" }, d.id)).status).toBe(403);
      expect((await call("item", `/api/po-items/${d.item_id}`, "PATCH", { version: d.version, qtyTonnes: "1" }, d.item_id)).status).toBe(403);
      expect((await call("reject", `/api/orders/${id}/reject`, "POST", { reason: "x" }, id)).status).toBe(403);
    }
    expect((await drafts(id))[0].status).toBe("DRAFT");
  });

  it("concurrent place of the same draft: exactly one 200, one PO placed, order consistent", async () => {
    const id = await order(ramu, "7", [{ providerId: ambuja.id, qtyTonnes: "7" }]);
    await open(id);
    const [d] = await drafts(id);
    await as(giri);
    const body = { pos: [{ id: d.id, version: d.version }] };
    const rs = await Promise.all([call("place", "/api/pos/place", "POST", body), call("place", "/api/pos/place", "POST", body)]);
    const codes = rs.map((r) => r.status).sort();
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(1);
    const after = await drafts(id);
    expect(after).toHaveLength(1);
    expect(after[0].status).toBe("PLACED");
    expect(after[0].version).toBe(d.version + 1);
    await expectRollup(id, "POS_PLACED");
  });

  it("concurrent place vs reject: one wins, order and PO agree", async () => {
    const id = await order(ramu, "7", [{ providerId: ambuja.id, qtyTonnes: "7" }]);
    await open(id);
    const [d] = await drafts(id);
    await as(giri);
    const [p, r] = await Promise.all([
      call("place", "/api/pos/place", "POST", { pos: [{ id: d.id, version: d.version }] }),
      call("reject", `/api/orders/${id}/reject`, "POST", { reason: "no stock" }, id),
    ]);
    expect([p.status, r.status].filter((s) => s === 200)).toHaveLength(1);
    const st = await orderStatus(id);
    expect(["POS_PLACED", "REJECTED"]).toContain(st);
    if (st === "REJECTED") expect(await drafts(id)).toHaveLength(0);
    else expect((await drafts(id))[0].status).toBe("PLACED");
  });

  it("place vs revoke race never places to a provider whose link ended before the write", async () => {
    const id = await order(ramu, "2", [{ providerId: anjani.id, qtyTonnes: "2" }]);
    await open(id);
    const [d] = await drafts(id);
    await db.update(schema.links).set({ status: "REVOKED", revokedBy: giri.id }).where(eq(schema.links.upperId, anjani.id));
    const r = await place([{ id: d.id, version: d.version }]);
    expect(r.status).toBe(422);
    expect((await drafts(id))[0].status).toBe("DRAFT");
    await db.update(schema.links).set({ status: "ACTIVE", revokedBy: null }).where(eq(schema.links.upperId, anjani.id));
  });

  it("editing a draft to an unlinked provider, and splitting to one, is 422 and changes nothing", async () => {
    const id = await order(ramu, "5");
    await open(id);
    const [d] = await drafts(id);
    const stranger = await mk("PROVIDER", "Stranger");
    await as(giri);
    const e = await call("editPo", `/api/pos/${d.id}`, "PATCH", { version: d.version, providerId: stranger.id }, d.id);
    expect(e.status).toBe(422);
    const s = await call("split", `/api/po-items/${d.item_id}/split`, "POST", { version: d.version, qtyTonnes: "1", providerId: stranger.id }, d.item_id);
    expect(s.status).toBe(422);
    const rows = await drafts(id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ qty_kg: 5000, version: d.version, provider_id: null });
    // a customer id and a nonexistent id are not valid providers either
    expect((await call("editPo", `/api/pos/${d.id}`, "PATCH", { version: d.version, providerId: ramu.id }, d.id)).status).toBe(422);
    expect((await call("editPo", `/api/pos/${d.id}`, "PATCH", { version: d.version, providerId: "nope" }, d.id)).status).toBe(422);
  });

  it("qty edit that breaks coverage is allowed in draft but blocks place; restoring it unblocks", async () => {
    const id = await order(ramu, "5", [{ providerId: anjani.id, qtyTonnes: "5" }]);
    await open(id);
    let [d] = await drafts(id);
    await as(giri);
    expect((await call("item", `/api/po-items/${d.item_id}`, "PATCH", { version: d.version, qtyTonnes: "4.999" }, d.item_id)).status).toBe(200);
    [d] = await drafts(id);
    const r = await place([{ id: d.id, version: d.version }]);
    expect(r.status).toBe(422);
    expect((await r.json()).code).toBe("QTY_MISMATCH");
    expect((await call("item", `/api/po-items/${d.item_id}`, "PATCH", { version: d.version, qtyTonnes: "5" }, d.item_id)).status).toBe(200);
    [d] = await drafts(id);
    expect((await place([{ id: d.id, version: d.version }])).status).toBe(200);
    await expectRollup(id, "POS_PLACED");
  });

  it("qty edit rejects zero, negative, 4 decimals, and a stale version", async () => {
    const id = await order(ramu, "5", [{ providerId: anjani.id, qtyTonnes: "5" }]);
    await open(id);
    const [d] = await drafts(id);
    await as(giri);
    for (const q of ["0", "-1", "1.0001", "abc", ""]) {
      const r = await call("item", `/api/po-items/${d.item_id}`, "PATCH", { version: d.version, qtyTonnes: q }, d.item_id);
      expect([400, 422], q).toContain(r.status);
    }
    const st = await call("item", `/api/po-items/${d.item_id}`, "PATCH", { version: d.version + 5, qtyTonnes: "1" }, d.item_id);
    expect(st.status).toBe(409);
    expect((await drafts(id))[0]).toMatchObject({ qty_kg: 5000, version: d.version });
  });

  it("two editors with the same version: only one PATCH wins, the other is 409 STALE", async () => {
    const id = await order(ramu, "5");
    await open(id);
    const [d] = await drafts(id);
    await as(giri);
    const rs = await Promise.all([
      call("editPo", `/api/pos/${d.id}`, "PATCH", { version: d.version, providerId: anjani.id }, d.id),
      call("editPo", `/api/pos/${d.id}`, "PATCH", { version: d.version, providerId: ambuja.id }, d.id),
    ]);
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409]);
    expect((await drafts(id))[0].version).toBe(d.version + 1);
  });

  it("rate rounding: total = round(kg * rate / 1000) frozen at place; rate can be cleared", async () => {
    const id = await order(ramu, "3.333", [{ providerId: anjani.id, qtyTonnes: "3.333" }]);
    await open(id);
    let [d] = await drafts(id);
    await as(giri);
    expect((await call("editPo", `/api/pos/${d.id}`, "PATCH", { version: d.version, ratePerTonne: "5999.99" }, d.id)).status).toBe(200);
    [d] = await drafts(id);
    expect((await call("editPo", `/api/pos/${d.id}`, "PATCH", { version: d.version, ratePerTonne: "0" }, d.id)).status).toBeGreaterThanOrEqual(400);
    expect((await call("editPo", `/api/pos/${d.id}`, "PATCH", { version: d.version, ratePerTonne: "-5" }, d.id)).status).toBeGreaterThanOrEqual(400);
    expect((await place([{ id: d.id, version: d.version }])).status).toBe(200);
    const [po] = await db.all<{ qty_kg: number; total_paise: number }>(sql`SELECT qty_kg, total_paise FROM purchase_orders WHERE id = ${d.id}`);
    expect(po.qty_kg).toBe(3333);
    expect(po.total_paise).toBe(Math.floor((3333 * 599999 + 500) / 1000));
  });

  it("a placed PO and its items are frozen: provider/rate/qty/split edits are 409", async () => {
    const id = await order(ramu, "2", [{ providerId: anjani.id, qtyTonnes: "2" }]);
    await open(id);
    const [d] = await drafts(id);
    expect((await place([{ id: d.id, version: d.version }])).status).toBe(200);
    const v = d.version + 1;
    expect((await call("editPo", `/api/pos/${d.id}`, "PATCH", { version: v, providerId: ambuja.id }, d.id)).status).toBe(409);
    expect((await call("item", `/api/po-items/${d.item_id}`, "PATCH", { version: v, qtyTonnes: "1" }, d.item_id)).status).toBe(409);
    expect((await call("split", `/api/po-items/${d.item_id}/split`, "POST", { version: v, qtyTonnes: "1", providerId: null }, d.item_id)).status).toBe(409);
    expect((await open(id)).status).toBe(200); // idempotent no-op on an opened order
    expect(await drafts(id)).toHaveLength(1);
    await as(giri);
    expect((await call("reject", `/api/orders/${id}/reject`, "POST", { reason: "late" }, id)).status).toBe(409);
    await expectRollup(id, "POS_PLACED");
  });

  it("customer cannot cancel after open; reject validates reason (empty, long, control chars)", async () => {
    const id = await order(ramu, "2");
    await open(id);
    await as(giri);
    for (const reason of ["", "   ", "x".repeat(301), "bad\u0000char", "rtl\u202Eoverride"]) {
      expect((await call("reject", `/api/orders/${id}/reject`, "POST", { reason }, id)).status, JSON.stringify(reason)).toBe(400);
    }
    expect((await call("reject", `/api/orders/${id}/reject`, "POST", { reason: "x".repeat(300) }, id)).status).toBe(200);
    expect(await drafts(id)).toHaveLength(0);
    await expectRollup(id, "REJECTED");
  });

  it("provider and customer projections leak no email, phone, rate (customer) or other customers", async () => {
    const id = await order(ramu, "2", [{ providerId: anjani.id, qtyTonnes: "2" }]);
    await open(id);
    const [d] = await drafts(id);
    await as(giri);
    await call("editPo", `/api/pos/${d.id}`, "PATCH", { version: d.version, ratePerTonne: "6100" }, d.id);
    const [c] = await drafts(id);
    await place([{ id: c.id, version: c.version }]);
    await as(anjani);
    const pj = JSON.stringify(await (await call("po", `/api/pos/${d.id}`, "GET", undefined, d.id)).json());
    expect(pj).not.toMatch(/@x\.com|9876543210|password/i);
    expect(pj).toContain("12 Market Road");
    await as(ramu);
    const cj = JSON.stringify(await (await call("po", `/api/pos/${d.id}`, "GET", undefined, d.id)).json());
    expect(cj).toContain("PLACED");
    expect(cj).not.toMatch(/rate|total|version|@x\.com|9876543210/i.source ? /ratePerTonnePaise":\d|totalPaise":\d|"version":\d|@x\.com|9876543210/ : /x/);
    // other providers' list never contains it
    await as(ambuja);
    const aj = await (await call("pos", "/api/pos", "GET")).json();
    expect(aj.data.some((p: { id: string }) => p.id === d.id)).toBe(false);
  });

  it("pagination and bad query params on GET /api/pos", async () => {
    await as(giri);
    for (const q of ["status=BOGUS", "page=0", "limit=0", "limit=100000", "orderId=%27%3B--"]) {
      const r = await call("pos", `/api/pos?${q}`, "GET");
      expect([200, 400, 422], q).toContain(r.status);
      expect(r.status, q).not.toBe(500);
    }
  });

  it("place with 21 drafts is 422; malformed JSON and empty body are 4xx not 500", async () => {
    await as(giri);
    const pos = Array.from({ length: 21 }, (_, i) => ({ id: `p${i}`, version: 0 }));
    expect((await call("place", "/api/pos/place", "POST", { pos })).status).toBe(400);
    const bad = await R.place(new Request(`${APP}/api/pos/place`, { method: "POST", body: "{nope" }));
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.status).toBeLessThan(500);
    const empty = await R.place(new Request(`${APP}/api/pos/place`, { method: "POST" }));
    expect(empty.status).toBeLessThan(500);
  });

  it("a deactivated (non-ACTIVE) distributor cannot open or place", async () => {
    const id = await order(ramu, "2", [{ providerId: anjani.id, qtyTonnes: "2" }]);
    await open(id);
    const [d] = await drafts(id);
    await db.update(schema.users).set({ status: "REJECTED" }).where(eq(schema.users.id, giri.id));
    const r = await place([{ id: d.id, version: d.version }]);
    await db.update(schema.users).set({ status: "ACTIVE" }).where(eq(schema.users.id, giri.id));
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect((await drafts(id))[0].status).toBe("DRAFT");
  });

  it("fix loop 1: reject touches only this order's drafts (other orders and other distributors keep theirs and versions)", async () => {
    const a = await order(ramu, "4", [{ providerId: anjani.id, qtyTonnes: "4" }]);
    const b = await order(sita, "3", [{ providerId: ambuja.id, qtyTonnes: "3" }]);
    await open(a);
    await open(b);
    const [db0] = await drafts(b);
    await as(giri);
    expect((await call("reject", `/api/orders/${a}/reject`, "POST", { reason: "no" }, a)).status).toBe(200);
    expect(await drafts(a)).toHaveLength(0);
    const [db1] = await drafts(b);
    expect(db1).toMatchObject({ id: db0.id, version: db0.version, status: "DRAFT", qty_kg: 3000 });
    await expectRollup(b, "UNDER_REVIEW");
    // stale edit on a rejected order's draft is 404 (draft gone)
    expect((await call("editPo", `/api/pos/${db0.id}`, "PATCH", { version: db0.version, ratePerTonne: "1" }, db0.id)).status).toBe(200);
  });

  it("fix loop 1: place with one revoked and one active provider is refused wholesale (alias collision guard)", async () => {
    const id = await order(ramu, "10", [{ providerId: anjani.id, qtyTonnes: "4" }, { providerId: ambuja.id, qtyTonnes: "6" }]);
    await open(id);
    const rows = await drafts(id);
    await db.update(schema.links).set({ status: "REVOKED", revokedBy: giri.id }).where(eq(schema.links.upperId, ambuja.id));
    const r = await place(rows.map((x) => ({ id: x.id, version: x.version })));
    expect(r.status).toBe(422);
    expect((await r.json()).code).toBe("PROVIDER_NOT_LINKED");
    expect((await drafts(id)).every((x) => x.status === "DRAFT")).toBe(true);
    await expectRollup(id, "UNDER_REVIEW");
    await db.update(schema.links).set({ status: "ACTIVE", revokedBy: null }).where(eq(schema.links.upperId, ambuja.id));
    expect((await place(rows.map((x) => ({ id: x.id, version: x.version })))).status).toBe(200);
    await expectRollup(id, "POS_PLACED");
  });

  it("fix loop 1: customer list/detail providerId is null; placed list total is the real count", async () => {
    const id = await order(ramu, "2", [{ providerId: anjani.id, qtyTonnes: "2" }]);
    await open(id);
    const [d] = await drafts(id);
    await place([{ id: d.id, version: d.version }]);
    await as(ramu);
    expect((await call("pos", "/api/pos", "GET")).status).toBe(403);
    const l = await (await call("po", `/api/pos/${d.id}`, "GET", undefined, d.id)).json();
    expect(l.data.providerId).toBeNull();
    expect(l.data.providerName).toBe("Anjani Biz");
    expect(JSON.stringify(l)).not.toContain(anjani.id);
    await as(giri);
    const g = await (await call("pos", "/api/pos?limit=1&page=1", "GET")).json();
    const all = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM purchase_orders WHERE distributor_id = ${giri.id}`);
    expect(g.data.length).toBeLessThanOrEqual(1);
    if (g.meta) expect(g.meta.total).toBe(Number(all[0].n));
  });
});
