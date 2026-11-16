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
const dir = mkdtempSync(path.join(tmpdir(), "cl-qav17-"));
process.env.DATABASE_URL = `file:${path.join(dir, "qa17.db")}`;
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
const call = (r: string, p: string, method: "GET" | "POST" | "PATCH" | "PUT" | "DELETE", body?: unknown, id?: string) =>
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
    open: (await import("@/app/api/orders/[id]/open/route")).POST as unknown as Route,
    place: (await import("@/app/api/pos/place/route")).POST as unknown as Route,
    accept: (await import("@/app/api/pos/[id]/accept/route")).POST as unknown as Route,
    dispatch: (await import("@/app/api/pos/[id]/dispatch/route")).POST as unknown as Route,
    invoice: (await import("@/app/api/pos/[id]/invoices/route")).POST as unknown as Route,
    list: (await import("@/app/api/provider-invoices/route")).GET as unknown as Route,
    pay: (await import("@/app/api/provider-invoices/[id]/payments/route")).POST as unknown as Route,
    payments: (await import("@/app/api/provider-payments/route")).GET as unknown as Route,
    balances: (await import("@/app/api/balances/route")).GET as unknown as Route,
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


async function order(customer: U, qty: string, prov: U = anjani): Promise<string> {
  await as(customer);
  const r = await call("create", "/api/orders", "POST", { distributorId: giri.id, qtyTonnes: qty, allocations: [{ providerId: prov.id, qtyTonnes: qty }], neededBy: days(3), address: "12 Market Road", city: "Pune", pincode: "411001" });
  expect(r.status).toBe(201);
  return (await r.json()).data.id;
}
const act = async (who: U, route: string, poId: string, body?: unknown) => {
  await as(who);
  return call(route, `/api/pos/${poId}/${route}`, "POST", body, poId);
};
const inv = (poId: string, body: Record<string, unknown>, who: U = anjani) => act(who, "invoice", poId, { invoiceDate: days(0), ratePerTonne: "5400", ...body });
const poStatus = async (id: string) => (await db.all<{ status: string }>(sql`SELECT status FROM purchase_orders WHERE id = ${id}`))[0].status;

/** A PO of `tonnes` for Anjani, placed (and optionally accepted/dispatched). */
async function po(tonnes: string, upTo: "PLACED" | "ACCEPTED" | "DISPATCHED" = "DISPATCHED", prov: U = anjani): Promise<{ poId: string; orderId: string }> {
  const orderId = await order(ramu, tonnes, prov);
  await as(giri);
  expect((await call("open", `/api/orders/${orderId}/open`, "POST", undefined, orderId)).status).toBe(200);
  const [d] = await db.all<{ id: string; version: number }>(sql`SELECT p.id, p.version FROM po_items i JOIN purchase_orders p ON p.id = i.po_id WHERE i.order_id = ${orderId}`);
  expect((await call("place", "/api/pos/place", "POST", { pos: [{ id: d.id, version: d.version }] })).status).toBe(200);
  if (upTo !== "PLACED") expect((await act(prov, "accept", d.id)).status).toBe(200);
  if (upTo === "DISPATCHED") expect((await act(prov, "dispatch", d.id, { dispatchDate: days(0) })).status).toBe(201);
  return { poId: d.id, orderId };
}


const payBody = (b: Record<string, unknown> = {}) => ({ amount: "1000", paidOn: days(0), mode: "UPI", ...b });
const pay = async (who: U, invId: string, b: Record<string, unknown> = {}) => {
  await as(who);
  return call("pay", `/api/provider-invoices/${invId}/payments`, "POST", payBody(b), invId);
};
async function invoiced(tonnes: string, parts: string[], prov: U = anjani): Promise<{ poId: string; invIds: string[] }> {
  const { poId } = await po(tonnes, "DISPATCHED", prov);
  const invIds: string[] = [];
  for (const q of parts) {
    const r = await inv(poId, { invoiceNo: `N${++n}`, qtyTonnes: q }, prov);
    expect(r.status).toBe(201);
    invIds.push((await r.json()).data.id);
  }
  return { poId, invIds };
}
const get = async (who: U, r: string, p: string) => {
  await as(who);
  return (await call(r, p, "GET")).json();
};
const invStatus = async (id: string) => (await db.all<{ status: string }>(sql`SELECT status FROM provider_invoices WHERE id = ${id}`))[0].status;

const setInvDate = (id: string, d: string) => db.run(sql`UPDATE provider_invoices SET invoice_date = ${d} WHERE id = ${id}`);
const count = async (id: string) => (await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM provider_payments WHERE provider_invoice_id = ${id}`))[0].n;

describe("QA V17", () => {
  it("auth: anon 401, provider/customer 403, foreign + unknown + malformed id 404/400, nothing stored", async () => {
    const { invIds } = await invoiced("5", ["5"]);
    state.cookies = new Map();
    expect((await call("pay", "/x", "POST", payBody(), invIds[0])).status).toBe(401);
    expect((await pay(anjani, invIds[0])).status).toBe(403);
    expect((await pay(ramu, invIds[0])).status).toBe(403);
    expect((await pay(other, invIds[0])).status).toBe(404);
    expect((await pay(giri, "00000000-0000-7000-8000-000000000000")).status).toBe(404);
    expect([400, 404]).toContain((await pay(giri, "not-an-id")).status);
    expect(await count(invIds[0])).toBe(0);
  });

  it("no PUT/PATCH/DELETE handlers on payment routes", async () => {
    for (const p of ["@/app/api/provider-invoices/[id]/payments/route", "@/app/api/provider-payments/route", "@/app/api/balances/route"]) {
      const m = (await import(p)) as Record<string, unknown>;
      for (const v of ["PUT", "PATCH", "DELETE"]) expect(m[v], `${p} ${v}`).toBeUndefined();
    }
    const { existsSync } = await import("node:fs");
    expect(existsSync(path.resolve(import.meta.dirname, "../../src/app/api/provider-payments/[id]"))).toBe(false);
  });

  it("multi-payment boundary: exact remainder ok, 1 paisa more rejected, then fully paid rejects anything", async () => {
    const { invIds } = await invoiced("5", ["5"]); // 27,000.00
    expect((await pay(giri, invIds[0], { amount: "9000.33" })).status).toBe(201);
    expect((await pay(giri, invIds[0], { amount: "9000.33" })).status).toBe(201);
    expect((await pay(giri, invIds[0], { amount: "8999.35" })).status).toBe(422);
    expect((await pay(giri, invIds[0], { amount: "8999.34" })).status).toBe(201);
    expect(await invStatus(invIds[0])).toBe("PAID");
    const r = await pay(giri, invIds[0], { amount: "0.01" });
    expect(r.status).toBe(422);
    expect((await r.json()).code).toBe("AMOUNT_EXCEEDS_OUTSTANDING");
    expect(await count(invIds[0])).toBe(3);
  });

  it("paid_on bounds: invoice date and today inclusive; day before / after rejected (backdated invoice)", async () => {
    const { invIds } = await invoiced("5", ["5"]);
    await setInvDate(invIds[0], days(-10));
    expect((await pay(giri, invIds[0], { amount: "1", paidOn: days(-11) })).status).toBe(422);
    expect((await pay(giri, invIds[0], { amount: "1", paidOn: days(-10) })).status).toBe(201);
    expect((await pay(giri, invIds[0], { amount: "1", paidOn: days(0) })).status).toBe(201);
    expect((await pay(giri, invIds[0], { amount: "1", paidOn: days(1) })).status).toBe(400);
    expect((await pay(giri, invIds[0], { amount: "1", paidOn: "2026-13-01" })).status).toBe(400);
    expect((await pay(giri, invIds[0], { amount: "1", paidOn: "" })).status).toBe(400);
    expect(await count(invIds[0])).toBe(2);
  });

  it("mode enum, reference length, amount formats", async () => {
    const { invIds } = await invoiced("5", ["5"]);
    for (const m of ["CASH", "UPI", "NEFT", "RTGS", "IMPS", "CHEQUE", "OTHER"]) expect((await pay(giri, invIds[0], { amount: "1", mode: m })).status, m).toBe(201);
    for (const m of ["upi", "CARD", "", null, 5]) expect((await pay(giri, invIds[0], { amount: "1", mode: m })).status, String(m)).toBe(400);
    expect((await pay(giri, invIds[0], { amount: "1", reference: "r".repeat(64) })).status).toBe(201);
    expect((await pay(giri, invIds[0], { amount: "1", reference: "r".repeat(65) })).status).toBe(400);
    expect((await pay(giri, invIds[0], { amount: "1", reference: "   " })).status).toBe(201);
    for (const a of ["0", "-5", "1.234", "abc", "", "1e3", "99999999999999"]) expect((await pay(giri, invIds[0], { amount: a })).status, a).toBe(400);
    expect((await pay(giri, invIds[0], { amount: 100 })).status).toBe(400);
    expect(await count(invIds[0])).toBe(9);
  });

  it("amount larger than invoice by a huge value is 422 not 500", async () => {
    const { invIds } = await invoiced("5", ["5"]);
    expect((await pay(giri, invIds[0], { amount: "9999999" })).status).toBe(422);
  });

  it("PO PAID only when fully invoiced and every invoice paid; second invoice unpaid blocks", async () => {
    const { poId, invIds } = await invoiced("10", ["5", "5"]);
    expect((await pay(giri, invIds[0], { amount: "27000" })).status).toBe(201);
    expect(await invStatus(invIds[0])).toBe("PAID");
    expect(await poStatus(poId)).toBe("INVOICED");
    expect((await pay(giri, invIds[1], { amount: "26999.99" })).status).toBe(201);
    expect(await poStatus(poId)).toBe("INVOICED");
    expect((await pay(giri, invIds[1], { amount: "0.01" })).status).toBe(201);
    expect(await poStatus(poId)).toBe("PAID");
  });

  it("balance math and isolation across providers/distributors", async () => {
    const b0 = await get(giri, "balances", "/api/balances");
    const base = (id: string) => (b0.data.rows.find((r: { counterpartyId: string }) => r.counterpartyId === id) ?? { invoicedPaise: 0, paidPaise: 0 }) as { invoicedPaise: number; paidPaise: number };
    const A0 = base(anjani.id), B0 = base(ambuja.id);
    const a = await invoiced("5", ["5"], anjani); // 27,000
    await invoiced("2", ["2"], ambuja); // 10,800
    expect((await pay(giri, a.invIds[0], { amount: "10000.25" })).status).toBe(201);
    const g = await get(giri, "balances", "/api/balances");
    expect(g.data.kind).toBe("PAYABLE");
    const row = (rows: { counterpartyId: string }[], id: string) => rows.find((r) => r.counterpartyId === id) as unknown as Record<string, number>;
    expect(row(g.data.rows, anjani.id)).toMatchObject({ invoicedPaise: A0.invoicedPaise + 2_700_000, paidPaise: A0.paidPaise + 1_000_025 });
    expect(row(g.data.rows, ambuja.id)).toMatchObject({ invoicedPaise: B0.invoicedPaise + 1_080_000, paidPaise: B0.paidPaise });
    expect(g.data.totalOutstandingPaise).toBe(g.data.rows.reduce((s: number, r: { outstandingPaise: number }) => s + r.outstandingPaise, 0));
    const p = await get(anjani, "balances", "/api/balances");
    expect(p.data.kind).toBe("OUTSTANDING");
    expect(p.data.rows.map((r: { counterpartyId: string }) => r.counterpartyId)).toEqual([giri.id]);
    expect(row(p.data.rows, giri.id)).toMatchObject({ invoicedPaise: A0.invoicedPaise + 2_700_000, paidPaise: A0.paidPaise + 1_000_025 });
    const o = await get(other, "balances", "/api/balances");
    expect(o.data.rows).toEqual([]);
    const lp = await get(ambuja, "payments", "/api/provider-payments");
    expect(lp.data.rows ?? lp.data).toBeDefined();
    expect(JSON.stringify(lp)).not.toContain(a.invIds[0]);
    const la = await get(anjani, "payments", "/api/provider-payments");
    expect(JSON.stringify(la)).toContain(a.invIds[0]);
    await as(ramu);
    expect((await call("balances", "/api/balances", "GET")).status).toBe(403);
    expect((await call("payments", "/api/provider-payments", "GET")).status).toBe(403);
    state.cookies = new Map();
    expect((await call("balances", "/api/balances", "GET")).status).toBe(401);
  });

  it("payments list paging params validated", async () => {
    await as(giri);
    expect((await call("payments", "/api/provider-payments?page=0", "GET")).status).toBe(400);
    expect((await call("payments", "/api/provider-payments?limit=9999", "GET")).status).toBe(400);
  });

  it("loop1: reference rejects zero-width, bidi, control chars; allows normal punctuation/unicode", async () => {
    const { invIds } = await invoiced("5", ["5"]);
    for (const c of ["\u200b", "\u200e", "\u202e", "\u2066", "\ufeff", "\t", "\n", "\u0000", "\u007f"]) {
      expect((await pay(giri, invIds[0], { amount: "1", reference: `UTR${c}1` })).status, JSON.stringify(c)).toBe(400);
    }
    expect((await pay(giri, invIds[0], { amount: "1", reference: "UTR/2026-11 #A_9 रु" })).status).toBe(201);
    expect(await count(invIds[0])).toBe(1);
  });

  it("loop1: exact total/header past 200 counterparties, including payments on a tail row", async () => {
    const big = await mk("PROVIDER", "BigQa");
    await links.forceLink(db, admin as never, big.id, giri.id);
    const [{ id: anyPo }] = await db.all<{ id: string }>(sql`SELECT id FROM purchase_orders LIMIT 1`);
    const now = Date.now();
    const ins = (id: string, d: string, amt: number) => db.run(sql`INSERT INTO provider_invoices (id, po_id, provider_id, distributor_id, invoice_no, invoice_date, qty_kg, rate_per_tonne_paise, amount_paise, status, created_at)
      VALUES (${id}, ${anyPo}, ${big.id}, ${d}, ${id}, ${days(0)}, 1000, ${amt}, ${amt}, 'UNPAID', ${now})`);
    for (let i = 0; i < 203; i += 1) {
      const d = `qa-dist-${i}`;
      await db.run(sql`INSERT INTO users (id, email, password_hash, role, status, name, business_name, created_at) VALUES (${d}, ${`${d}@x.com`}, 'x', 'DISTRIBUTOR', 'ACTIVE', ${d}, ${d}, ${now})`);
      await ins(`qa-inv-${i}`, d, 50_000);
    }
    await ins("qa-giri-1", giri.id, 7_000);
    await db.run(sql`INSERT INTO provider_payments (id, provider_invoice_id, provider_id, distributor_id, amount_paise, paid_on, mode, created_by, created_at)
      VALUES ('qa-pay-1', 'qa-giri-1', ${big.id}, ${giri.id}, 2500, ${days(0)}, 'UPI', ${giri.id}, ${now})`);
    const bal = (await get(big, "balances", "/api/balances")).data;
    expect(bal.rows.length).toBeLessThanOrEqual(200);
    expect(bal.totalOutstandingPaise).toBe(203 * 50_000 + 7_000 - 2_500);
    const { getProviderDistributorHeader } = await import("@/server/services/balances");
    const [bu] = await db.select().from(schema.users).where(eq(schema.users.id, big.id));
    expect(await getProviderDistributorHeader(db, bu, giri.id)).toMatchObject({ invoicedPaise: 7_000, paidPaise: 2_500, outstandingPaise: 4_500 });
    const gb = (await get(giri, "balances", "/api/balances")).data;
    expect(gb.rows.find((r: { counterpartyId: string }) => r.counterpartyId === big.id)).toMatchObject({ invoicedPaise: 7_000, paidPaise: 2_500 });
  });
});
