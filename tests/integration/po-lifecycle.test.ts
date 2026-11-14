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
const dir = mkdtempSync(path.join(tmpdir(), "cl-polife-"));
process.env.DATABASE_URL = `file:${path.join(dir, "p.db")}`;
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
    accept: (await import("@/app/api/pos/[id]/accept/route")).POST as unknown as Route,
    rejectPo: (await import("@/app/api/pos/[id]/reject/route")).POST as unknown as Route,
    dispatch: (await import("@/app/api/pos/[id]/dispatch/route")).POST as unknown as Route,
    deliver: (await import("@/app/api/orders/[id]/deliver/route")).POST as unknown as Route,
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


const poRow = async (id: string) => (await db.all<{ status: string; version: number; provider_id: string | null; rate: number | null }>(sql`SELECT status, version, provider_id, rate_per_tonne_paise AS rate FROM purchase_orders WHERE id = ${id}`))[0];
const setProvider = async (poId: string, provider: U) => {
  await as(giri);
  const v = (await poRow(poId)).version;
  expect((await call("editPo", `/api/pos/${poId}`, "PATCH", { version: v, providerId: provider.id }, poId)).status).toBe(200);
};


const orderStatus = async (id: string) => (await db.all<{ status: string }>(sql`SELECT status FROM orders WHERE id = ${id}`))[0].status;
const act = async (who: U, route: string, poId: string, body?: unknown) => {
  await as(who);
  return call(route, `/api/pos/${poId}/${route}`, "POST", body, poId);
};
const accept = (poId: string, who: U = anjani) => act(who, "accept", poId);
const rejectPo = (poId: string, reason = "Out of stock", who: U = anjani) => act(who, "rejectPo", poId, { reason });
const dispatch = (poId: string, body: Record<string, unknown> = { dispatchDate: days(0) }, who: U = anjani) => act(who, "dispatch", poId, body);
const deliver = async (orderId: string, who: U = giri) => {
  await as(who);
  return call("deliver", `/api/orders/${orderId}/deliver`, "POST", undefined, orderId);
};

/** Orders one allocation per provider, opens and places everything; returns order id and its PO ids by provider. */
async function placed(customer: U, alloc: Array<[U, string]>, total: string): Promise<{ orderId: string; pos: Map<string, string> }> {
  const orderId = await order(customer, total, alloc.map(([p, q]) => ({ providerId: p.id, qtyTonnes: q })));
  await open(orderId);
  const rows = await drafts(orderId);
  expect((await place(pick(rows))).status).toBe(200);
  return { orderId, pos: new Map(rows.map((r) => [r.provider_id as string, r.id])) };
}
async function expectConsistent(orderId: string) {
  const { computeOrderStatus } = await import("@/server/domain/order-status");
  const [o] = await db.all<{ status: string }>(sql`SELECT status FROM orders WHERE id = ${orderId}`);
  const ps = await db.all<{ status: string }>(sql`SELECT p.status FROM po_items i JOIN purchase_orders p ON p.id = i.po_id WHERE i.order_id = ${orderId}`);
  // Recompute from the status the order would have had before the rollup: the rollup never leaves its own set.
  expect(computeOrderStatus(o.status as never, ps.map((p) => p.status) as never)).toBe(o.status);
}

describe("provider accept (S5)", () => {
  it("accepts a PLACED PO once, with ownership and role enforced", async () => {
    const { orderId, pos } = await placed(ramu, [[anjani, "5"]], "5");
    const po = pos.get(anjani.id)!;
    expect((await accept(po, ambuja)).status).toBe(404);
    expect((await accept(po, giri)).status).toBe(403);
    expect((await accept(po, ramu)).status).toBe(403);
    expect((await accept(po)).status).toBe(200);
    expect((await poRow(po)).status).toBe("ACCEPTED");
    expect((await accept(po)).status).toBe(409);
    expect(await orderStatus(orderId)).toBe("POS_PLACED");
    await expectConsistent(orderId);
  });
  it("is 404 for a DRAFT PO and for an unknown id", async () => {
    const o = await order(ramu, "2", [{ providerId: anjani.id, qtyTonnes: "2" }]);
    await open(o);
    const [d] = await drafts(o);
    expect((await accept(d.id)).status).toBe(404);
    expect((await accept("nope")).status).toBe(404);
  });
  it("concurrent accepts: exactly one wins", async () => {
    const { pos } = await placed(ramu, [[anjani, "1"]], "1");
    const po = pos.get(anjani.id)!;
    await as(anjani);
    const rs = await Promise.all([1, 2, 3].map(() => call("accept", `/api/pos/${po}/accept`, "POST", undefined, po)));
    expect(rs.map((r) => r.status).sort()).toEqual([200, 409, 409]);
  });
});

describe("provider reject regenerates drafts (S4/S5)", () => {
  it("rejects a PLACED PO, copies frozen items into provider-less drafts and reverts the order", async () => {
    const { orderId, pos } = await placed(ramu, [[anjani, "4"], [ambuja, "6"]], "10");
    const po = pos.get(anjani.id)!;
    expect(await orderStatus(orderId)).toBe("POS_PLACED");
    expect((await rejectPo(po, "  ", anjani)).status).toBe(400);
    expect((await rejectPo(po, "Out of stock", ambuja)).status).toBe(404);
    expect((await rejectPo(po, "Out of stock", giri)).status).toBe(403);
    const r = await rejectPo(po, "Out of stock");
    expect(r.status).toBe(200);
    expect((await poRow(po)).status).toBe("REJECTED");
    const [row] = await db.all<{ reason: string; decided: number | null }>(sql`SELECT reject_reason AS reason, decided_at AS decided FROM purchase_orders WHERE id = ${po}`);
    expect(row.reason).toBe("Out of stock");
    expect(row.decided).not.toBeNull();
    expect(await orderStatus(orderId)).toBe("UNDER_REVIEW");
    const live = (await drafts(orderId)).filter((d) => d.status === "DRAFT");
    expect(live).toHaveLength(1);
    expect(live[0].provider_id).toBeNull();
    expect(live[0].qty_kg).toBe(4000);
    const [src] = await db.all<{ s: string | null }>(sql`SELECT source_item_id AS s FROM po_items WHERE po_id = ${live[0].id}`);
    const old = (await drafts(orderId)).find((d) => d.id === po)!;
    expect(src.s).toBe(old.item_id);
    await expectConsistent(orderId);
    expect((await rejectPo(po)).status).toBe(409);
  });
  it("Giri re-picks a provider for the regenerated draft and places it", async () => {
    const { orderId, pos } = await placed(ramu, [[ambuja, "7"]], "7");
    expect((await rejectPo(pos.get(ambuja.id)!, "No stock", ambuja)).status).toBe(200);
    const [d] = (await drafts(orderId)).filter((x) => x.status === "DRAFT");
    await setProvider(d.id, anjani);
    const cur = await poRow(d.id);
    expect((await place([{ id: d.id, version: cur.version }])).status).toBe(200);
    expect(await orderStatus(orderId)).toBe("POS_PLACED");
    expect((await accept(d.id)).status).toBe(200);
    await expectConsistent(orderId);
  });
  it("a combined PO yields one draft per source order", async () => {
    const a = await order(ramu, "2", [{ providerId: ambuja.id, qtyTonnes: "2" }]);
    const b = await order(sita, "3", [{ providerId: ambuja.id, qtyTonnes: "3" }]);
    await open(a);
    await open(b);
    const [da] = await drafts(a);
    const [db2] = await drafts(b);
    await as(giri);
    const c = await call("editPo", `/api/pos/${da.id}`, "PATCH", { version: da.version, ratePerTonne: "6000" }, da.id);
    expect(c.status).toBe(200);
    const bundle = [{ id: da.id, version: (await poRow(da.id)).version }, { id: db2.id, version: db2.version }];
    const R2 = (await import("@/app/api/pos/combine/route")).POST as unknown as Route;
    expect((await R2(new Request(`${APP}/api/pos/combine`, { method: "POST", body: JSON.stringify({ pos: bundle }) }))).status).toBe(200);
    const target = (await drafts(a))[0].id;
    expect((await place([{ id: target, version: (await poRow(target)).version }])).status).toBe(200);
    expect((await rejectPo(target, "No capacity", ambuja)).status).toBe(200);
    for (const o of [a, b]) {
      expect(await orderStatus(o)).toBe("UNDER_REVIEW");
      expect((await drafts(o)).filter((x) => x.status === "DRAFT")).toHaveLength(1);
      await expectConsistent(o);
    }
  });
  it("a link revoke does not block reject; coverage still equals order qty", async () => {
    const { orderId, pos } = await placed(ramu, [[anjani, "3"]], "3");
    await db.run(sql`UPDATE links SET status = 'REVOKED', revoked_by = ${giri.id} WHERE upper_id = ${anjani.id} AND lower_id = ${giri.id}`);
    try {
      expect((await rejectPo(pos.get(anjani.id)!)).status).toBe(200);
    } finally {
      await db.run(sql`UPDATE links SET status = 'ACTIVE', revoked_by = NULL WHERE upper_id = ${anjani.id} AND lower_id = ${giri.id}`);
    }
    const [c] = await db.all<{ cov: number; qty: number }>(sql`SELECT o.qty_kg AS qty, (SELECT SUM(i.qty_kg) FROM po_items i JOIN purchase_orders p ON p.id = i.po_id WHERE i.order_id = o.id AND p.status <> 'REJECTED') AS cov FROM orders o WHERE o.id = ${orderId}`);
    expect(c.cov).toBe(c.qty);
  });
  it("a customer GET on a REJECTED PO is 404", async () => {
    const { pos } = await placed(ramu, [[anjani, "2"]], "2");
    const po = pos.get(anjani.id)!;
    await as(ramu);
    expect((await call("po", `/api/pos/${po}`, "GET", undefined, po)).status).toBe(200);
    expect((await rejectPo(po)).status).toBe(200);
    await as(ramu);
    expect((await call("po", `/api/pos/${po}`, "GET", undefined, po)).status).toBe(404);
  });
});

describe("provider dispatch (S5)", () => {
  it("requires ACCEPTED, validates the date window and stores transport details", async () => {
    const { orderId, pos } = await placed(ramu, [[anjani, "5"]], "5");
    const po = pos.get(anjani.id)!;
    expect((await dispatch(po)).status).toBe(409); // still PLACED
    await accept(po);
    expect((await dispatch(po, { dispatchDate: days(1) })).status).toBe(422);
    expect((await dispatch(po, { dispatchDate: days(-2) })).status).toBe(422);
    expect((await dispatch(po, { dispatchDate: "2026-13-40" })).status).toBe(400);
    expect((await dispatch(po, { dispatchDate: days(0), vehicleNo: "x" })).status).toBe(400);
    expect((await dispatch(po, { dispatchDate: days(0) }, ambuja)).status).toBe(404);
    expect((await dispatch(po, { dispatchDate: days(0) }, giri)).status).toBe(403);
    const r = await dispatch(po, { dispatchDate: days(0), vehicleNo: "ts 09-ab 1234", driverPhone: "9876543210" });
    expect(r.status).toBe(201);
    const [d] = await db.all<{ date: string; v: string; ph: string; prov: string; dist: string }>(sql`SELECT dispatch_date AS date, vehicle_no AS v, driver_phone AS ph, provider_id AS prov, distributor_id AS dist FROM dispatches WHERE po_id = ${po}`);
    expect(d).toEqual({ date: days(0), v: "TS09AB1234", ph: "9876543210", prov: anjani.id, dist: giri.id });
    expect((await poRow(po)).status).toBe("DISPATCHED");
    expect(await orderStatus(orderId)).toBe("DISPATCHED");
    expect((await dispatch(po)).status).toBe(409);
    await expectConsistent(orderId);
  });
  it("order rolls up to DISPATCHED only when all live POs are dispatched", async () => {
    const { orderId, pos } = await placed(ramu, [[anjani, "4"], [ambuja, "6"]], "10");
    const [pa, pb] = [pos.get(anjani.id)!, pos.get(ambuja.id)!];
    await accept(pa);
    await accept(pb, ambuja);
    expect((await dispatch(pa)).status).toBe(201);
    expect(await orderStatus(orderId)).toBe("POS_PLACED");
    await expectConsistent(orderId);
    expect((await dispatch(pb, { dispatchDate: days(0) }, ambuja)).status).toBe(201);
    expect(await orderStatus(orderId)).toBe("DISPATCHED");
    await expectConsistent(orderId);
  });
  it("ignores a rejected sibling PO when rolling up", async () => {
    const { orderId, pos } = await placed(ramu, [[anjani, "4"], [ambuja, "6"]], "10");
    await rejectPo(pos.get(ambuja.id)!, "No stock", ambuja);
    const [d] = (await drafts(orderId)).filter((x) => x.status === "DRAFT");
    await accept(pos.get(anjani.id)!);
    expect((await dispatch(pos.get(anjani.id)!)).status).toBe(201);
    // the regenerated draft is live, so the order is still under review
    expect(await orderStatus(orderId)).toBe("UNDER_REVIEW");
    expect(d).toBeTruthy();
    await expectConsistent(orderId);
  });
  it("concurrent dispatches: exactly one wins and one dispatch row exists", async () => {
    const { pos } = await placed(ramu, [[anjani, "1"]], "1");
    const po = pos.get(anjani.id)!;
    await accept(po);
    await as(anjani);
    const rs = await Promise.all([1, 2, 3].map(() => call("dispatch", `/api/pos/${po}/dispatch`, "POST", { dispatchDate: days(0) }, po)));
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    const [n] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM dispatches WHERE po_id = ${po}`);
    expect(n.n).toBe(1);
  });
});

describe("revoked links do not block the provider (arch 6.2)", () => {
  it("accept and dispatch still work after the provider-distributor link is revoked", async () => {
    const { pos } = await placed(sita, [[ambuja, "2"]], "2");
    const po = pos.get(ambuja.id)!;
    await db.run(sql`UPDATE links SET status = 'REVOKED', revoked_by = ${giri.id} WHERE upper_id = ${ambuja.id} AND lower_id = ${giri.id}`);
    try {
      expect((await accept(po, ambuja)).status).toBe(200);
      expect((await dispatch(po, { dispatchDate: days(0) }, ambuja)).status).toBe(201);
    } finally {
      await db.run(sql`UPDATE links SET status = 'ACTIVE', revoked_by = NULL WHERE upper_id = ${ambuja.id} AND lower_id = ${giri.id}`);
    }
  });
});

describe("deliver (S5)", () => {
  it("distributor marks a DISPATCHED order delivered; only then, only own", async () => {
    const { orderId, pos } = await placed(ramu, [[anjani, "2"]], "2");
    const po = pos.get(anjani.id)!;
    expect((await deliver(orderId)).status).toBe(409); // POS_PLACED
    await accept(po);
    await dispatch(po);
    expect((await deliver(orderId, other)).status).toBe(404);
    expect((await deliver(orderId, ramu)).status).toBe(403);
    expect((await deliver(orderId, anjani)).status).toBe(403);
    expect((await deliver(orderId)).status).toBe(200);
    expect(await orderStatus(orderId)).toBe("DELIVERED");
    const [o] = await db.all<{ d: number | null }>(sql`SELECT delivered_at AS d FROM orders WHERE id = ${orderId}`);
    expect(o.d).not.toBeNull();
    expect((await deliver(orderId)).status).toBe(409);
    expect((await deliver("nope")).status).toBe(404);
  });
});

describe("visibility of the chain", () => {
  it("customer sees dispatch date and vehicle on own items but no driver phone; distributor and provider see more; reject reason is for distributor/provider", async () => {
    const { orderId, pos } = await placed(ramu, [[anjani, "2"], [ambuja, "3"]], "5");
    const [pa, pb] = [pos.get(anjani.id)!, pos.get(ambuja.id)!];
    await rejectPo(pb, "Plant shutdown", ambuja);
    await accept(pa);
    await dispatch(pa, { dispatchDate: days(0), vehicleNo: "MH12AB1234", driverPhone: "9123456780" });

    await as(ramu);
    const o = (await (await call("one", `/api/orders/${orderId}`, "GET", undefined, orderId)).json()).data;
    const line = o.pos.find((p: { poId: string }) => p.poId === pa);
    expect(line).toMatchObject({ status: "DISPATCHED", dispatchDate: days(0), vehicleNo: "MH12AB1234" });
    expect(JSON.stringify(o)).not.toContain("9123456780");
    expect(JSON.stringify(o)).not.toContain("Plant shutdown");
    const cpo = (await (await call("po", `/api/pos/${pa}`, "GET", undefined, pa)).json()).data;
    expect(cpo.dispatch).toEqual({ dispatchDate: days(0), vehicleNo: "MH12AB1234", driverPhone: null });
    expect(cpo.rejectReason).toBeNull();

    await as(giri);
    const g = (await (await call("po", `/api/pos/${pa}`, "GET", undefined, pa)).json()).data;
    expect(g.dispatch).toEqual({ dispatchDate: days(0), vehicleNo: "MH12AB1234", driverPhone: "9123456780" });
    const gr = (await (await call("po", `/api/pos/${pb}`, "GET", undefined, pb)).json()).data;
    expect(gr.status).toBe("REJECTED");
    expect(gr.rejectReason).toBe("Plant shutdown");
    expect(gr.dispatch).toBeNull();

    await as(ambuja);
    const pr = (await (await call("po", `/api/pos/${pb}`, "GET", undefined, pb)).json()).data;
    expect(pr.rejectReason).toBe("Plant shutdown");
  });
});
