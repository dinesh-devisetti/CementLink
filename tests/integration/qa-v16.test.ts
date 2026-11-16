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
const dir = mkdtempSync(path.join(tmpdir(), "cl-qav16-"));
process.env.DATABASE_URL = `file:${path.join(dir, "qa.db")}`;
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
let giri: U, ramu: U, sita: U, anjani: U, ambuja: U;
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
  };

  await svc.seedAdmin(db, "admin@x.com", "AdminPass123!");
  [admin] = await db.select().from(schema.users).where(eq(schema.users.email, "admin@x.com"));
  giri = await mk("DISTRIBUTOR", "Giri");
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


async function order(customer: U, qty: string): Promise<string> {
  await as(customer);
  const r = await call("create", "/api/orders", "POST", { distributorId: giri.id, qtyTonnes: qty, allocations: [{ providerId: anjani.id, qtyTonnes: qty }], neededBy: days(3), address: "12 Market Road", city: "Pune", pincode: "411001" });
  expect(r.status).toBe(201);
  return (await r.json()).data.id;
}
const act = async (who: U, route: string, poId: string, body?: unknown) => {
  await as(who);
  return call(route, `/api/pos/${poId}/${route}`, "POST", body, poId);
};
const inv = (poId: string, body: Record<string, unknown>, who: U = anjani) => act(who, "invoice", poId, { invoiceDate: days(0), ratePerTonne: "5400", ...body });
const sumKg = async (poId: string) => Number((await db.all<{ s: number | null }>(sql`SELECT SUM(qty_kg) AS s FROM provider_invoices WHERE po_id = ${poId}`))[0].s ?? 0);
const poStatus = async (id: string) => (await db.all<{ status: string }>(sql`SELECT status FROM purchase_orders WHERE id = ${id}`))[0].status;

/** A PO of `tonnes` for Anjani, placed (and optionally accepted/dispatched). */
async function po(tonnes: string, upTo: "PLACED" | "ACCEPTED" | "DISPATCHED" = "DISPATCHED"): Promise<{ poId: string; orderId: string }> {
  const orderId = await order(ramu, tonnes);
  await as(giri);
  expect((await call("open", `/api/orders/${orderId}/open`, "POST", undefined, orderId)).status).toBe(200);
  const [d] = await db.all<{ id: string; version: number }>(sql`SELECT p.id, p.version FROM po_items i JOIN purchase_orders p ON p.id = i.po_id WHERE i.order_id = ${orderId}`);
  expect((await call("place", "/api/pos/place", "POST", { pos: [{ id: d.id, version: d.version }] })).status).toBe(200);
  if (upTo !== "PLACED") expect((await act(anjani, "accept", d.id)).status).toBe(200);
  if (upTo === "DISPATCHED") expect((await act(anjani, "dispatch", d.id, { dispatchDate: days(0) })).status).toBe(201);
  return { poId: d.id, orderId };
}


const listAs = async (who: U, qs = "") => {
  await as(who);
  return call("list", `/api/provider-invoices${qs}`, "GET");
};

describe("QA V16", () => {
  it("double submit of the same invoice number: exactly one 201, the rest 409 DUPLICATE_INVOICE_NO, qty counted once", async () => {
    const { poId } = await po("10");
    await as(anjani);
    const rs = await Promise.all([1, 2, 3].map(() => call("invoice", `/api/pos/${poId}/invoices`, "POST", { invoiceNo: "DBL-1", invoiceDate: days(0), qtyTonnes: "2", ratePerTonne: "5000" }, poId)));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(1);
    for (const r of rs.filter((x) => x.status !== 201)) expect([409]).toContain(r.status);
    expect(await sumKg(poId)).toBe(2000);
  });

  it("tonnes input is kg-exact: 4 decimals, comma, whitespace-only, negative, over 1000 t rejected; 0.001 and 1.5 ok", async () => {
    const { poId } = await po("10");
    for (const q of ["1.2345", "1,5", "", " ", "-1", "1001", "0.0005", ".5", "1."]) expect((await inv(poId, { invoiceNo: "T1", qtyTonnes: q })).status, q).toBe(400);
    const r = await inv(poId, { invoiceNo: "T2", qtyTonnes: "1.5", ratePerTonne: "5400.55" });
    expect(r.status).toBe(201);
    expect((await r.json()).data.amountPaise).toBe(Math.floor((1500 * 540055 + 500) / 1000));
    expect(await sumKg(poId)).toBe(1500);
  });

  it("amount rounds half up, stored amount satisfies the CHECK (kg x rate)", async () => {
    const { poId } = await po("10");
    // 1 kg x 500 paise = 0.5 paise -> 1 ; 1 kg x 499 paise -> 0 -> 400
    expect((await inv(poId, { invoiceNo: "H1", qtyTonnes: "0.001", ratePerTonne: "5" })).status).toBe(201);
    expect((await inv(poId, { invoiceNo: "H2", qtyTonnes: "0.001", ratePerTonne: "4.99" })).status).toBe(400);
    const [row] = await db.all<{ a: number; t: string }>(sql`SELECT amount_paise AS a, typeof(amount_paise) AS t FROM provider_invoices WHERE invoice_no = 'H1'`);
    expect(row).toEqual({ a: 1, t: "integer" });
  });

  it("max values: 1000 t at Rs 100000/t stays an exact integer", async () => {
    const { poId } = await po("1000");
    const r = await inv(poId, { invoiceNo: "MAX1", qtyTonnes: "1000", ratePerTonne: "100000" });
    expect(r.status).toBe(201);
    expect((await r.json()).data.amountPaise).toBe(10_000_000_000);
    expect(await poStatus(poId)).toBe("INVOICED");
    expect((await inv(poId, { invoiceNo: "MAX2", qtyTonnes: "1", ratePerTonne: "100001" })).status).toBe(400);
  });

  it("invoice date window: placed date itself ok, day before 422, today ok, tomorrow 400, bad formats 400", async () => {
    const { poId } = await po("10");
    expect((await inv(poId, { invoiceNo: "D0", qtyTonnes: "1", invoiceDate: days(-1) })).status).toBe(422);
    for (const d of ["", "2026/01/01", "26-01-01", "1999-12-31", "2026-13-01", "0000-00-00", "2026-01-01T00:00:00Z"]) expect((await inv(poId, { invoiceNo: "D1", qtyTonnes: "1", invoiceDate: d })).status, d).toBe(400);
    expect((await inv(poId, { invoiceNo: "D2", qtyTonnes: "1", invoiceDate: days(1) })).status).toBe(400);
    const placed = (await db.all<{ d: string }>(sql`SELECT date(COALESCE(placed_at, created_at)/1000 + 19800, 'unixepoch') AS d FROM purchase_orders WHERE id = ${poId}`))[0].d;
    expect((await inv(poId, { invoiceNo: "D3", qtyTonnes: "1", invoiceDate: placed })).status).toBe(201);
    expect((await inv(poId, { invoiceNo: "D4", qtyTonnes: "1", invoiceDate: days(0) })).status).toBe(201);
  });

  it("invoice number: length 40 ok, 41 bad, spaces/unicode/script bad; stored upper-case; trimmed", async () => {
    const { poId } = await po("10");
    expect((await inv(poId, { invoiceNo: "A".repeat(41), qtyTonnes: "1" })).status).toBe(400);
    for (const s of ["A B", "<script>", "\u00e9a", "A;DROP", "", "   "]) expect((await inv(poId, { invoiceNo: s, qtyTonnes: "1" })).status, s).toBe(400);
    expect((await inv(poId, { invoiceNo: "B".repeat(40), qtyTonnes: "1" })).status).toBe(201);
    expect((await inv(poId, { invoiceNo: "  ab/1_2.3-x  ", qtyTonnes: "1" })).status).toBe(201);
    const r = await db.all<{ n: string }>(sql`SELECT invoice_no AS n FROM provider_invoices WHERE po_id = ${poId} ORDER BY created_at`);
    expect(r[1].n).toBe("AB/1_2.3-X");
  });

  it("malformed bodies: array, null, string, missing fields, non-string numbers, extra keys -> 400, nothing stored", async () => {
    const { poId } = await po("3");
    await as(anjani);
    for (const b of [[], null, "x", {}, { invoiceNo: "Z1" }, { invoiceNo: "Z1", invoiceDate: days(0), qtyTonnes: 1, ratePerTonne: "5" }, { invoiceNo: "Z1", invoiceDate: days(0), qtyTonnes: "1", ratePerTonne: "5", poId: "x" }, { invoiceNo: "Z1", invoiceDate: days(0), qtyTonnes: "1", ratePerTonne: "NaN" }, { invoiceNo: "Z1", invoiceDate: days(0), qtyTonnes: "1", ratePerTonne: "5e3" }]) {
      const r = await call("invoice", `/api/pos/${poId}/invoices`, "POST", b, poId);
      expect(r.status, JSON.stringify(b)).toBe(400);
    }
    expect(await sumKg(poId)).toBe(0);
  });

  it("CSRF: foreign Origin is 403; unauthenticated is 401", async () => {
    const { poId } = await po("3");
    await as(anjani);
    state.headers = new Headers({ origin: "http://evil.example" });
    expect((await call("invoice", `/api/pos/${poId}/invoices`, "POST", { invoiceNo: "O1", invoiceDate: days(0), qtyTonnes: "1", ratePerTonne: "5000" }, poId)).status).toBe(403);
    state.cookies = new Map();
    state.headers = new Headers({ origin: APP });
    expect((await call("invoice", `/api/pos/${poId}/invoices`, "POST", { invoiceNo: "O1", invoiceDate: days(0), qtyTonnes: "1", ratePerTonne: "5000" }, poId)).status).toBe(401);
    expect((await call("list", "/api/provider-invoices", "GET")).status).toBe(401);
    expect(await sumKg(poId)).toBe(0);
  });

  it("revoked link does not block invoicing a dispatched PO; suspended provider cannot invoice", async () => {
    const { poId } = await po("4");
    await db.run(sql`UPDATE links SET status = 'REVOKED' WHERE provider_id = ${anjani.id} AND distributor_id = ${giri.id}`).catch(() => undefined);
    expect((await inv(poId, { invoiceNo: "L1", qtyTonnes: "1" })).status).toBe(201);
    await db.update(schema.users).set({ status: "REJECTED" }).where(eq(schema.users.id, anjani.id));
    const r = await inv(poId, { invoiceNo: "L2", qtyTonnes: "1" });
    expect([401, 403]).toContain(r.status);
    await db.update(schema.users).set({ status: "ACTIVE" }).where(eq(schema.users.id, anjani.id));
    expect(await sumKg(poId)).toBe(1000);
  });

  it("pagination: page/limit bounds, meta total, no overlap between pages, newest first", async () => {
    const { poId } = await po("20");
    for (let i = 1; i <= 5; i += 1) expect((await inv(poId, { invoiceNo: `PG${i}`, qtyTonnes: "1" })).status).toBe(201);
    const total = (await (await listAs(anjani)).json()).meta.total;
    const p1 = await (await listAs(anjani, "?page=1&limit=2")).json();
    const p2 = await (await listAs(anjani, "?page=2&limit=2")).json();
    expect(p1.data).toHaveLength(2);
    expect(p1.meta).toMatchObject({ total, page: 1, limit: 2 });
    expect(p1.data.map((x: { id: string }) => x.id).filter((i: string) => p2.data.some((y: { id: string }) => y.id === i))).toEqual([]);
    expect(p1.data[0].invoiceNo).toBe("PG5");
    const far = await (await listAs(anjani, "?page=1000&limit=50")).json();
    expect(far.data).toEqual([]);
    for (const qs of ["?page=0", "?page=-1", "?limit=0", "?limit=51", "?page=1001", "?page=abc", "?limit=1.5"]) expect((await listAs(anjani, qs)).status, qs).toBe(400);
  });

  it("distributor list shows provider name as counterparty and no write endpoint exists for distributors", async () => {
    const { poId } = await po("2");
    expect((await inv(poId, { invoiceNo: "DV1", qtyTonnes: "1" })).status).toBe(201);
    const d = await (await listAs(giri)).json();
    const row = d.data.find((x: { invoiceNo: string }) => x.invoiceNo === "DV1");
    expect(row.counterparty).toContain("Anjani");
    expect(row.status).toBe("UNPAID");
    await as(giri);
    expect((await call("invoice", `/api/pos/${poId}/invoices`, "POST", {}, poId)).status).toBe(403);
  });
});
