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
const dir = mkdtempSync(path.join(tmpdir(), "cl-ppay-"));
process.env.DATABASE_URL = `file:${path.join(dir, "pp.db")}`;
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

describe("provider payments (V17)", () => {
  it("part then full payment: invoice and PO roll up to PAID; amounts are integer paise", async () => {
    const { poId, invIds } = await invoiced("10", ["10"]); // 10 t x 5400 = 54,000.00 = 5_400_000 paise
    const r1 = await pay(giri, invIds[0], { amount: "20000.50", reference: " UTR-1 " });
    expect(r1.status).toBe(201);
    expect((await r1.json()).data.outstandingPaise).toBe(3_399_950);
    expect(await invStatus(invIds[0])).toBe("UNPAID");
    expect(await poStatus(poId)).toBe("INVOICED");
    const r2 = await pay(giri, invIds[0], { amount: "33999.50", mode: "NEFT" });
    expect(r2.status).toBe(201);
    expect(await invStatus(invIds[0])).toBe("PAID");
    expect(await poStatus(poId)).toBe("PAID");
    const rows = await db.all<{ a: number; t: string; ref: string | null }>(sql`SELECT amount_paise AS a, typeof(amount_paise) AS t, reference AS ref FROM provider_payments WHERE provider_invoice_id = ${invIds[0]} ORDER BY created_at, id`);
    expect(rows.map((x) => x.a)).toEqual([2_000_050, 3_399_950]);
    expect(rows.every((x) => x.t === "integer")).toBe(true);
    expect(rows[0].ref).toBe("UTR-1");
    expect((await pay(giri, invIds[0], { amount: "1" })).status).toBe(422);
  });

  it("PO stays INVOICED until every invoice is paid; a partly invoiced PO never becomes PAID", async () => {
    const { poId, invIds } = await invoiced("10", ["4"]);
    expect((await pay(giri, invIds[0], { amount: "21600" })).status).toBe(201);
    expect(await invStatus(invIds[0])).toBe("PAID");
    expect(await poStatus(poId)).toBe("DISPATCHED");
    await as(anjani);
    const r = await inv(poId, { invoiceNo: `N${++n}`, qtyTonnes: "6" });
    const id2 = (await r.json()).data.id;
    expect(await poStatus(poId)).toBe("INVOICED");
    expect((await pay(giri, id2, { amount: "32400" })).status).toBe(201);
    expect(await poStatus(poId)).toBe("PAID");
  });

  it("over-outstanding is 422 AMOUNT_EXCEEDS_OUTSTANDING and stores nothing", async () => {
    const { invIds } = await invoiced("5", ["5"]); // 27,000.00
    expect((await pay(giri, invIds[0], { amount: "10000" })).status).toBe(201);
    const r = await pay(giri, invIds[0], { amount: "17000.01" });
    expect(r.status).toBe(422);
    const b = await r.json();
    expect(b.code).toBe("AMOUNT_EXCEEDS_OUTSTANDING");
    expect(b.fields.amount).toMatch(/outstanding/);
    const [c] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM provider_payments WHERE provider_invoice_id = ${invIds[0]}`);
    expect(c.n).toBe(1);
  });

  it("concurrent payments cannot jointly exceed the invoice", async () => {
    const { invIds } = await invoiced("5", ["5"]);
    await as(giri);
    const rs = await Promise.all([1, 2, 3, 4].map(() => call("pay", `/api/provider-invoices/${invIds[0]}/payments`, "POST", payBody({ amount: "10000" }), invIds[0])));
    const ok = rs.filter((r) => r.status === 201).length;
    expect(ok).toBe(2);
    expect(rs.filter((r) => r.status !== 201).every((r) => [409, 422].includes(r.status))).toBe(true);
    const [s] = await db.all<{ s: number }>(sql`SELECT SUM(amount_paise) AS s FROM provider_payments WHERE provider_invoice_id = ${invIds[0]}`);
    expect(s.s).toBe(2_000_000);
    expect(await invStatus(invIds[0])).toBe("UNPAID");
  });

  it("validates date window, mode, reference, extra keys, amount format", async () => {
    const { invIds } = await invoiced("5", ["5"]);
    const bad = async (b: Record<string, unknown>, status = 400) => expect((await pay(giri, invIds[0], b)).status, JSON.stringify(b)).toBe(status);
    await bad({ paidOn: days(1) });
    await bad({ paidOn: days(-30) }, 422); // before invoice date (today)
    await bad({ paidOn: "2026-02-30" });
    await bad({ mode: "BITCOIN" });
    await bad({ reference: "x".repeat(65) });
    await bad({ amount: "0" });
    await bad({ amount: "-5" });
    await bad({ amount: "1e3" });
    await bad({ amount: "10.005" });
    await bad({ reference: "ab\u0000cd" });
    await bad({ reference: "ab\ncd" });
    await bad({ reference: "ab\u202ecd" });
    await bad({ extra: 1 });
    await as(giri);
    const noBody = await call("pay", `/api/provider-invoices/${invIds[0]}/payments`, "POST", {}, invIds[0]);
    expect(noBody.status).toBe(400);
    expect((await pay(giri, invIds[0], { reference: "x".repeat(64) })).status).toBe(201);
  });

  it("isolation: only the owning distributor can pay; provider, customer, other distributor and unknown ids are denied", async () => {
    const { invIds } = await invoiced("5", ["5"]);
    expect((await pay(other, invIds[0])).status).toBe(404);
    expect((await pay(anjani, invIds[0])).status).toBe(403);
    expect((await pay(ramu, invIds[0])).status).toBe(403);
    expect((await pay(giri, "00000000-0000-0000-0000-000000000000")).status).toBe(404);
    expect((await pay(giri, "bad id!")).status).toBe(400);
    const [c] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM provider_payments WHERE provider_invoice_id = ${invIds[0]}`);
    expect(c.n).toBe(0);
    state.cookies = new Map();
    expect((await call("pay", "/x", "POST", payBody(), invIds[0])).status).toBe(401);
  });

  it("no update or delete route exists for payments", async () => {
    const root = path.resolve(import.meta.dirname, "../../src/app/api");
    const { readFileSync, existsSync } = await import("node:fs");
    for (const f of ["provider-payments/route.ts", "provider-invoices/[id]/payments/route.ts"]) {
      const s = readFileSync(path.join(root, f), "utf8");
      expect(s).not.toMatch(/export const (PUT|PATCH|DELETE)/);
    }
    expect(existsSync(path.join(root, "provider-payments/[id]"))).toBe(false);
    expect(existsSync(path.join(root, "provider-invoices/[id]/payments/[pid]"))).toBe(false);
    expect(R.payments).toBeDefined();
    const mod = await import("@/app/api/provider-payments/route");
    expect(Object.keys(mod).filter((k) => ["PUT", "PATCH", "DELETE", "POST"].includes(k))).toEqual([]);
  });

  it("balance math and receipts per role, scoped to the caller", async () => {
    const a = await invoiced("5", ["5"], ambuja); // 27,000.00 from Ambuja
    const b = await invoiced("10", ["4", "6"], ambuja); // 21,600 + 32,400
    expect((await pay(giri, a.invIds[0], { amount: "27000" })).status).toBe(201);
    expect((await pay(giri, b.invIds[0], { amount: "600.25" })).status).toBe(201);
    // Provider view: Ambuja sees only Giri.
    const pv = (await get(ambuja, "balances", "/api/balances")).data;
    expect(pv.kind).toBe("OUTSTANDING");
    expect(pv.rows).toHaveLength(1);
    expect(pv.rows[0]).toMatchObject({ counterpartyId: giri.id, invoicedPaise: 8_100_000, paidPaise: 2_760_025, outstandingPaise: 5_339_975 });
    expect(pv.totalOutstandingPaise).toBe(5_339_975);
    // Distributor view mirrors; Giri has Anjani invoices from other tests too, so check the Ambuja row only.
    const dv = (await get(giri, "balances", "/api/balances")).data;
    expect(dv.kind).toBe("PAYABLE");
    expect(dv.rows.find((r: { counterpartyId: string }) => r.counterpartyId === ambuja.id)).toMatchObject({ invoicedPaise: 8_100_000, paidPaise: 2_760_025, outstandingPaise: 5_339_975 });
    expect(dv.totalOutstandingPaise).toBe(dv.rows.reduce((s: number, r: { outstandingPaise: number }) => s + r.outstandingPaise, 0));
    // Receipts.
    const rec = await get(ambuja, "payments", "/api/provider-payments");
    expect(rec.meta.total).toBe(2);
    expect(rec.data.map((x: { amountPaise: number }) => x.amountPaise).sort((a: number, b: number) => a - b)).toEqual([60_025, 2_700_000]);
    expect(rec.data[0].counterparty).toBe("Giri Biz");
    // Isolation: other distributor and customers see nothing; customers cannot call.
    const ov = (await get(other, "balances", "/api/balances")).data;
    expect(ov.rows).toEqual([]);
    expect((await get(other, "payments", "/api/provider-payments")).meta.total).toBe(0);
    await as(ramu);
    expect((await call("balances", "/api/balances", "GET")).status).toBe(403);
    expect((await call("payments", "/api/provider-payments", "GET")).status).toBe(403);
    // Provider cannot post a payment even for its own invoice.
    expect((await pay(ambuja, a.invIds[0])).status).toBe(403);
  });
  it("totals and per-distributor header are exact even past the 200-row list cap", async () => {
    const big = await mk("PROVIDER", "Big");
    await links.forceLink(db, admin as never, big.id, giri.id);
    const [{ id: anyPo }] = await db.all<{ id: string }>(sql`SELECT id FROM purchase_orders LIMIT 1`);
    const now = Date.now();
    for (let i = 0; i < 205; i += 1) {
      const d = `bulk-dist-${i}`;
      await db.run(sql`INSERT INTO users (id, email, password_hash, role, status, name, business_name, created_at) VALUES (${d}, ${`${d}@x.com`}, 'x', 'DISTRIBUTOR', 'ACTIVE', ${d}, ${d}, ${now})`);
      await db.run(sql`INSERT INTO provider_invoices (id, po_id, provider_id, distributor_id, invoice_no, invoice_date, qty_kg, rate_per_tonne_paise, amount_paise, status, created_at)
        VALUES (${`bulk-inv-${i}`}, ${anyPo}, ${big.id}, ${d}, ${`B${i}`}, ${days(0)}, 1000, 100000, 100000, 'UNPAID', ${now})`);
    }
    await db.run(sql`INSERT INTO provider_invoices (id, po_id, provider_id, distributor_id, invoice_no, invoice_date, qty_kg, rate_per_tonne_paise, amount_paise, status, created_at)
      VALUES ('bulk-giri', ${anyPo}, ${big.id}, ${giri.id}, 'BG1', ${days(0)}, 1000, 1000, 1000, 'UNPAID', ${now})`);
    const bal = (await get(big, "balances", "/api/balances")).data;
    expect(bal.rows).toHaveLength(200);
    expect(bal.rows.some((r: { counterpartyId: string }) => r.counterpartyId === giri.id)).toBe(false);
    expect(bal.totalOutstandingPaise).toBe(205 * 100_000 + 1000);
    const { getProviderDistributorHeader } = await import("@/server/services/balances");
    const [bigUser] = await db.select().from(schema.users).where(eq(schema.users.id, big.id));
    const head = await getProviderDistributorHeader(db, bigUser, giri.id);
    expect(head).toMatchObject({ counterpartyId: giri.id, invoicedPaise: 1000, paidPaise: 0, outstandingPaise: 1000 });
  });
});
