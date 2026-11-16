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
const dir = mkdtempSync(path.join(tmpdir(), "cl-pinv-"));
process.env.DATABASE_URL = `file:${path.join(dir, "pi.db")}`;
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
const sumKg = async (poId: string) => Number((await db.all<{ s: number | null }>(sql`SELECT SUM(qty_kg) AS s FROM provider_invoices WHERE po_id = ${poId}`))[0].s ?? 0);
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

describe("provider invoices (V16)", () => {
  it("two parts: PO stays DISPATCHED until the sum equals the PO qty, then INVOICED; amount computed in SQL", async () => {
    const { poId, orderId } = await po("10");
    const r1 = await inv(poId, { invoiceNo: "inv-1", qtyTonnes: "4" });
    expect(r1.status).toBe(201);
    expect((await r1.json()).data.amountPaise).toBe(2_160_000);
    expect(await poStatus(poId)).toBe("DISPATCHED");
    const r2 = await inv(poId, { invoiceNo: "INV-2", qtyTonnes: "6.000", ratePerTonne: "5400.55" });
    expect(r2.status).toBe(201);
    expect(await poStatus(poId)).toBe("INVOICED");
    const rows = await db.all<{ no: string; amount: number; status: string; dist: string }>(sql`SELECT invoice_no AS no, amount_paise AS amount, status, distributor_id AS dist FROM provider_invoices WHERE po_id = ${poId} ORDER BY invoice_no`);
    expect(rows.map((x) => x.no)).toEqual(["INV-1", "INV-2"]);
    expect(rows[1].amount).toBe(3_240_330);
    expect(rows.every((x) => x.status === "UNPAID" && x.dist === giri.id)).toBe(true);
    // The order is not touched by provider invoices.
    expect((await db.all<{ status: string }>(sql`SELECT status FROM orders WHERE id = ${orderId}`))[0].status).toBe("DISPATCHED");
    const again = await inv(poId, { invoiceNo: "INV-3", qtyTonnes: "1" });
    expect(again.status).toBe(409);
    expect(await sumKg(poId)).toBe(10_000);
  });

  it("rejects qty over the remaining quantity with 422 QTY_EXCEEDS_PO", async () => {
    const { poId } = await po("5");
    expect((await inv(poId, { invoiceNo: "A1", qtyTonnes: "3" })).status).toBe(201);
    const r = await inv(poId, { invoiceNo: "A2", qtyTonnes: "2.001" });
    expect(r.status).toBe(422);
    expect((await r.json()).code).toBe("QTY_EXCEEDS_PO");
    expect(await sumKg(poId)).toBe(3000);
  });

  it("concurrent inserts can never exceed the PO qty", async () => {
    const { poId } = await po("10");
    await as(anjani);
    const rs = await Promise.all([1, 2, 3, 4, 5].map((i) => call("invoice", `/api/pos/${poId}/invoices`, "POST", { invoiceNo: `C${i}`, invoiceDate: days(0), qtyTonnes: "4", ratePerTonne: "5000" }, poId)));
    const ok = rs.filter((r) => r.status === 201).length;
    expect(ok).toBe(2);
    expect(rs.filter((r) => r.status !== 201).every((r) => r.status === 409 || r.status === 422)).toBe(true);
    expect(await sumKg(poId)).toBe(8000);
    expect(await poStatus(poId)).toBe("DISPATCHED");
  });

  it("concurrent inserts that exactly fill the PO roll it up once", async () => {
    const { poId } = await po("10");
    await as(anjani);
    const rs = await Promise.all([1, 2, 3].map((i) => call("invoice", `/api/pos/${poId}/invoices`, "POST", { invoiceNo: `F${i}`, invoiceDate: days(0), qtyTonnes: "5", ratePerTonne: "5000" }, poId)));
    expect(rs.filter((r) => r.status === 201)).toHaveLength(2);
    expect(await sumKg(poId)).toBe(10_000);
    expect(await poStatus(poId)).toBe("INVOICED");
  });

  it("409 DUPLICATE_INVOICE_NO per provider, case-insensitive; another provider may reuse the number", async () => {
    const { poId } = await po("10");
    expect((await inv(poId, { invoiceNo: "dup-1", qtyTonnes: "1" })).status).toBe(201);
    const r = await inv(poId, { invoiceNo: "DUP-1", qtyTonnes: "1" });
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe("DUPLICATE_INVOICE_NO");
    expect(await sumKg(poId)).toBe(1000);
    // Another provider may reuse the same number on its own PO.
    const theirs = await po("2", "DISPATCHED", ambuja);
    expect((await inv(theirs.poId, { invoiceNo: "DUP-1", qtyTonnes: "1" }, ambuja)).status).toBe(201);
  });

  it("requires a DISPATCHED PO: PLACED and ACCEPTED are 409, DRAFT/unknown/foreign are 404", async () => {
    const placedPo = await po("2", "PLACED");
    const acceptedPo = await po("2", "ACCEPTED");
    expect((await inv(placedPo.poId, { invoiceNo: "N1", qtyTonnes: "1" })).status).toBe(409);
    expect((await inv(acceptedPo.poId, { invoiceNo: "N2", qtyTonnes: "1" })).status).toBe(409);
    expect((await inv("nope", { invoiceNo: "N3", qtyTonnes: "1" })).status).toBe(404);
    const o = await order(sita, "1");
    await as(giri);
    await call("open", `/api/orders/${o}/open`, "POST", undefined, o);
    const [draft] = await db.all<{ id: string }>(sql`SELECT p.id FROM po_items i JOIN purchase_orders p ON p.id = i.po_id WHERE i.order_id = ${o}`);
    expect((await inv(draft.id, { invoiceNo: "N4", qtyTonnes: "1" })).status).toBe(404);
    expect(await sumKg(placedPo.poId)).toBe(0);
  });

  it("isolation: other provider 404, distributor and customer 403, lists are own only", async () => {
    const { poId } = await po("3");
    expect((await inv(poId, { invoiceNo: "I1", qtyTonnes: "1" }, ambuja)).status).toBe(404);
    expect((await inv(poId, { invoiceNo: "I1", qtyTonnes: "1" }, giri)).status).toBe(403);
    expect((await inv(poId, { invoiceNo: "I1", qtyTonnes: "1" }, ramu)).status).toBe(403);
    expect((await inv(poId, { invoiceNo: "I1", qtyTonnes: "1" })).status).toBe(201);
    const listFor = async (who: U) => {
      await as(who);
      return call("list", "/api/provider-invoices", "GET");
    };
    expect((await (await listFor(anjani)).json()).data.some((i: { poId: string }) => i.poId === poId)).toBe(true);
    expect((await (await listFor(giri)).json()).data.some((i: { poId: string }) => i.poId === poId)).toBe(true);
    const o = await (await listFor(ambuja)).json();
    expect(o.data.some((i: { poId: string }) => i.poId === poId)).toBe(false);
    expect((await (await listFor(other)).json()).data).toEqual([]);
    expect((await listFor(ramu)).status).toBe(403);
  });

  it("validation: amount must be > 0, strict keys, date window, formats", async () => {
    const { poId } = await po("4");
    expect((await inv(poId, { invoiceNo: "V1", qtyTonnes: "0.001", ratePerTonne: "0.01" })).status).toBe(400);
    expect((await inv(poId, { invoiceNo: "V1", qtyTonnes: "0", })).status).toBe(400);
    expect((await inv(poId, { invoiceNo: "V1", qtyTonnes: "1", ratePerTonne: "0" })).status).toBe(400);
    expect((await inv(poId, { invoiceNo: "V1", qtyTonnes: "1", amountPaise: 5 })).status).toBe(400);
    expect((await inv(poId, { invoiceNo: "V1", qtyTonnes: "1", invoiceDate: days(2) })).status).toBe(400);
    expect((await inv(poId, { invoiceNo: "V1", qtyTonnes: "1", invoiceDate: "2026-02-30" })).status).toBe(400);
    expect((await inv(poId, { invoiceNo: "-bad", qtyTonnes: "1" })).status).toBe(400);
    expect((await inv(poId, { invoiceNo: "V1", qtyTonnes: "1e3" })).status).toBe(400);
    const before = await inv(poId, { invoiceNo: "V2", qtyTonnes: "1", invoiceDate: days(-1) });
    expect(before.status).toBe(422);
    expect((await before.json()).code).toBe("INVALID_DATE");
    expect(await sumKg(poId)).toBe(0);
    // 1 kg at the smallest rate that still rounds to a paise
    expect((await inv(poId, { invoiceNo: "V3", qtyTonnes: "0.001", ratePerTonne: "5" })).status).toBe(201);
  });

  it("rate has no cap against the PO total (discounts and uplifts both fine)", async () => {
    const { poId } = await po("2");
    expect((await inv(poId, { invoiceNo: "R1", qtyTonnes: "2", ratePerTonne: "99999.99" })).status).toBe(201);
  });

  describe("stale read between the pre-read and the batch", () => {
    const fill = (poId: string, rolledUp: boolean) => async () => {
      await db.run(sql`INSERT INTO provider_invoices (id, po_id, provider_id, distributor_id, invoice_no, invoice_date, qty_kg, rate_per_tonne_paise, amount_paise, status, created_at)
        VALUES (${`fill-${poId}`}, ${poId}, ${anjani.id}, ${giri.id}, ${`FILL-${poId.slice(-6)}`}, ${days(0)}, 10000, 1000, 10000, 'UNPAID', 1)`);
      if (rolledUp) await db.run(sql`UPDATE purchase_orders SET status = 'INVOICED', version = version + 1 WHERE id = ${poId}`);
    };
    const run = async (rolledUp: boolean) => {
      const guard = await import("@/server/db/guard");
      const real = guard.guardedBatch;
      const { poId } = await po("10");
      const before = fill(poId, rolledUp);
      const spy = vi.spyOn(guard, "guardedBatch").mockImplementationOnce(async (...args) => {
        await before();
        return real(...args);
      });
      try {
        const r = await inv(poId, { invoiceNo: `S${rolledUp ? 2 : 1}-${poId.slice(-4)}`, qtyTonnes: "1" });
        expect(spy).toHaveBeenCalledTimes(1);
        return { r, poId };
      } finally {
        spy.mockRestore();
      }
    };
    it("a concurrent fill leaves the cap intact: 422 QTY_EXCEEDS_PO, SUM unchanged", async () => {
      const { r, poId } = await run(false);
      expect(r.status).toBe(422);
      expect((await r.json()).code).toBe("QTY_EXCEEDS_PO");
      expect(await sumKg(poId)).toBe(10_000);
    });
    it("a PO that already rolled up gives 409 INVALID_STATE", async () => {
      const { r, poId } = await run(true);
      expect(r.status).toBe(409);
      expect((await r.json()).code).toBe("INVALID_STATE");
      expect(await sumKg(poId)).toBe(10_000);
    });
  });
});
