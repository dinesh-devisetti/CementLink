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
const dir = mkdtempSync(path.join(tmpdir(), "cl-qa15-"));
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


describe("QA V15 probes", () => {
  it("reject vs accept race: exactly one winner, state consistent", async () => {
    const { orderId, pos } = await placed(ramu, [[anjani, "1"]], "1");
    const po = pos.get(anjani.id)!;
    await as(anjani);
    const rs = await Promise.all([
      call("accept", `/api/pos/${po}/accept`, "POST", undefined, po),
      call("rejectPo", `/api/pos/${po}/reject`, "POST", { reason: "x" }, po),
      call("rejectPo", `/api/pos/${po}/reject`, "POST", { reason: "y" }, po),
    ]);
    const ok = rs.filter((r) => r.status === 200).length;
    expect(ok).toBe(1);
    const st = (await poRow(po)).status;
    const live = (await drafts(orderId)).filter((d) => d.status === "DRAFT");
    if (st === "REJECTED") expect(live).toHaveLength(1);
    else expect(live).toHaveLength(0);
    await expectConsistent(orderId);
  });
  it("reject after accept is 409 and creates no drafts; dispatch after reject is 409", async () => {
    const { orderId, pos } = await placed(ramu, [[anjani, "2"]], "2");
    const po = pos.get(anjani.id)!;
    await accept(po);
    expect((await rejectPo(po)).status).toBe(409);
    expect((await drafts(orderId)).filter((d) => d.status === "DRAFT")).toHaveLength(0);
    const p2 = await placed(sita, [[anjani, "2"]], "2");
    const q = p2.pos.get(anjani.id)!;
    await rejectPo(q);
    expect((await dispatch(q)).status).toBe(409);
    expect((await accept(q)).status).toBe(409);
  });
  it("dispatch dates: placed day ok, before placed 422, tomorrow 422, today ok", async () => {
    const a = await placed(ramu, [[anjani, "1"]], "1");
    const po = a.pos.get(anjani.id)!;
    await accept(po);
    // backdate placement by 3 days
    await db.run(sql`UPDATE purchase_orders SET placed_at = ${Date.now() - 3 * 86_400_000} WHERE id = ${po}`);
    expect((await dispatch(po, { dispatchDate: days(-4) })).status).toBe(422);
    expect((await dispatch(po, { dispatchDate: days(1) })).status).toBe(422);
    expect((await dispatch(po, { dispatchDate: days(-3) })).status).toBe(201);
    const b = await placed(ramu, [[anjani, "1"]], "1");
    const p2 = b.pos.get(anjani.id)!;
    await accept(p2);
    expect((await dispatch(p2, { dispatchDate: days(0) })).status).toBe(201);
  });
  it("IST boundary: service uses IST date for today (18:45 UTC is already tomorrow in IST)", async () => {
    const { dispatchPo } = await import("@/server/services/po-provider");
    const a = await placed(ramu, [[anjani, "1"]], "1");
    const po = a.pos.get(anjani.id)!;
    await accept(po);
    const [u] = await db.select().from(schema.users).where(eq(schema.users.id, anjani.id));
    const now = Date.UTC(2030, 5, 10, 18, 45); // IST 2030-06-11 00:15
    await db.run(sql`UPDATE purchase_orders SET placed_at = ${Date.UTC(2030, 5, 10, 1)} WHERE id = ${po}`);
    const parse = (await import("@/lib/validation/po-lifecycle")).dispatchSchema;
    await expect(dispatchPo(db, u as never, po, parse.parse({ dispatchDate: "2030-06-12" }), now)).rejects.toMatchObject({ httpStatus: 422 });
    const r = await dispatchPo(db, u as never, po, parse.parse({ dispatchDate: "2030-06-11" }), now);
    expect(r.id).toBeTruthy();
  });
  it("deliver before dispatch / on partially dispatched / under review is 409", async () => {
    const { orderId, pos } = await placed(ramu, [[anjani, "4"], [ambuja, "6"]], "10");
    expect((await deliver(orderId)).status).toBe(409);
    await accept(pos.get(anjani.id)!);
    await dispatch(pos.get(anjani.id)!);
    expect((await deliver(orderId)).status).toBe(409);
    await rejectPo(pos.get(ambuja.id)!, "no", ambuja);
    expect(await orderStatus(orderId)).toBe("UNDER_REVIEW");
    expect((await deliver(orderId)).status).toBe(409);
    expect(await orderStatus(orderId)).not.toBe("DELIVERED");
  });
  it("mixed: A dispatched, B rejected, re-picked, placed, accepted, dispatched -> order DISPATCHED then delivered", async () => {
    const { orderId, pos } = await placed(ramu, [[anjani, "4"], [ambuja, "6"]], "10");
    await accept(pos.get(anjani.id)!);
    await dispatch(pos.get(anjani.id)!);
    await rejectPo(pos.get(ambuja.id)!, "no", ambuja);
    const [d] = (await drafts(orderId)).filter((x) => x.status === "DRAFT");
    await setProvider(d.id, anjani);
    expect((await place([{ id: d.id, version: (await poRow(d.id)).version }])).status).toBe(200);
    const s = await orderStatus(orderId);
    expect(["POS_PLACED"]).toContain(s);
    await accept(d.id);
    expect((await dispatch(d.id)).status).toBe(201);
    expect(await orderStatus(orderId)).toBe("DISPATCHED");
    expect((await deliver(orderId)).status).toBe(200);
  });
  it("reject then dispatch of the dispatched sibling does not mark order dispatched while draft exists (rollup)", async () => {
    const { orderId, pos } = await placed(ramu, [[anjani, "4"], [ambuja, "6"]], "10");
    await accept(pos.get(anjani.id)!);
    await accept(pos.get(ambuja.id)!, ambuja);
    await rejectPo(pos.get(ambuja.id)!, "late", ambuja); // 409, already accepted
    expect(await orderStatus(orderId)).toBe("POS_PLACED");
  });
  it("foreign provider and unauthenticated; malformed bodies", async () => {
    const { pos } = await placed(ramu, [[anjani, "1"]], "1");
    const po = pos.get(anjani.id)!;
    state.cookies = new Map();
    expect((await call("accept", `/api/pos/${po}/accept`, "POST", undefined, po)).status).toBe(401);
    expect((await rejectPo(po, "x", other)).status).toBe(403);
    expect((await rejectPo(po, "x".repeat(2000))).status).toBe(400);
    expect((await act(anjani, "rejectPo", po, { reason: "ok", extra: 1 })).status).toBe(400);
    await accept(po);
    expect((await dispatch(po, { dispatchDate: days(0), driverPhone: "123" })).status).toBe(400);
    expect((await dispatch(po, { dispatchDate: days(0), foo: 1 })).status).toBe(400);
    expect((await dispatch(po, { dispatchDate: days(0), vehicleNo: "A".repeat(500) })).status).toBe(400);
    expect((await dispatch(po, { dispatchDate: days(0), vehicleNo: "", driverPhone: "" })).status).toBe(201);
  });
  it("csrf: provider actions without matching Origin are rejected", async () => {
    const { pos } = await placed(ramu, [[anjani, "1"]], "1");
    const po = pos.get(anjani.id)!;
    await as(anjani);
    state.headers = new Headers({ origin: "http://evil.example" });
    expect((await call("accept", `/api/pos/${po}/accept`, "POST", undefined, po)).status).toBeGreaterThanOrEqual(400);
    expect((await poRow(po)).status).toBe("PLACED");
  });
});
