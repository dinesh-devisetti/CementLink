import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { sql } from "drizzle-orm";

const state = { headers: new Headers(), cookies: new Map<string, string>() };
vi.mock("next/headers", () => ({
  headers: async () => state.headers,
  cookies: async () => ({ get: (n: string) => (state.cookies.has(n) ? { name: n, value: state.cookies.get(n) } : undefined) }),
}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));

const APP = "http://localhost:3000";
const dir = mkdtempSync(path.join(tmpdir(), "cl-an-"));
process.env.DATABASE_URL = `file:${path.join(dir, "an.db")}`;
process.env.APP_URL = APP;

type Route = (req: Request, ctx?: { params: Promise<{ id: string }> }) => Promise<Response>;
let db: ReturnType<typeof import("@/server/db/client").getDb>;
let sess: typeof import("@/server/auth/session");
let R: Record<string, Route>;
let svc: typeof import("@/server/services/analytics");
const NOW = Date.UTC(2026, 0, 10);

async function user(id: string, role: string, business: string | null, status = "ACTIVE") {
  await db.run(sql`INSERT INTO users (id, email, password_hash, role, status, name, business_name, city, created_at) VALUES (${id}, ${id + "@x.com"}, 'x', ${role}, ${status}, ${"N-" + id}, ${business}, 'Pune', ${NOW + seq++})`);
}
let seq = 0;
const as = async (id: string) => { state.cookies.set("cl_session", (await sess.createSession(db, id, 1)).token); };
const get = (r: string, p: string, id?: string) => R[r](new Request(`${APP}${p}`), id ? { params: Promise.resolve({ id }) } : undefined);
async function order(id: string, cust: string, dist: string, kg: number, status: string) {
  await db.run(sql`INSERT INTO orders (id, customer_id, distributor_id, qty_kg, address, city, pincode, needed_by, status, created_at, updated_at) VALUES (${id}, ${cust}, ${dist}, ${kg}, 'A', 'Pune', '411001', '2026-02-01', ${status}, ${NOW + seq++}, ${NOW})`);
}
async function po(id: string, dist: string, prov: string | null, kg: number | null, status: string) {
  await db.run(sql`INSERT INTO purchase_orders (id, distributor_id, provider_id, status, qty_kg, created_at, updated_at) VALUES (${id}, ${dist}, ${prov}, ${status}, ${kg}, ${NOW}, ${NOW})`);
}
async function cinv(id: string, ord: string, cust: string, dist: string, kg: number, rate: number, status: string) {
  const amt = Math.floor((kg * rate + 500) / 1000);
  await db.run(sql`INSERT INTO customer_invoices (id, order_id, distributor_id, customer_id, invoice_no, invoice_date, qty_kg, rate_per_tonne_paise, amount_paise, status, created_at) VALUES (${id}, ${ord}, ${dist}, ${cust}, ${id}, '2026-01-10', ${kg}, ${rate}, ${amt}, ${status}, ${NOW})`);
  return amt;
}

// Fixture: every order status (9), every PO status (7), every customer invoice status (3).
const expectSales = { g: 0, h: 0, pend: 0 };
beforeAll(async () => {
  db = (await import("@/server/db/client")).getDb();
  sess = await import("@/server/auth/session");
  svc = await import("@/server/services/analytics");
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
  R = {
    dist: (await import("@/app/api/admin/analytics/distributors/route")).GET as unknown as Route,
    disp: (await import("@/app/api/admin/dispatches/route")).GET as unknown as Route,
    cust: (await import("@/app/api/admin/customers/route")).GET as unknown as Route,
    custId: (await import("@/app/api/admin/customers/[id]/route")).GET as unknown as Route,
  };
  await user("admin", "ADMIN", null);
  await user("g", "DISTRIBUTOR", "Giri");
  await user("h", "DISTRIBUTOR", "Hari");
  await user("idle", "DISTRIBUTOR", "Idle");
  await user("pend", "DISTRIBUTOR", "Pending", "PENDING");
  await user("pa", "PROVIDER", "Anjani");
  await user("pb", "PROVIDER", "Ambuja");
  await user("c1", "CUSTOMER", "Ramu Co");
  await user("c2", "CUSTOMER", null);
  await user("c3", "CUSTOMER", "NoOrders");

  const statuses = ["REQUESTED", "UNDER_REVIEW", "POS_PLACED", "DISPATCHED", "DELIVERED", "INVOICED", "PAID", "REJECTED", "CANCELLED"];
  for (const [i, s] of statuses.entries()) await order(`o-${s}`, i % 2 ? "c1" : "c2", "g", (i + 1) * 1000, s);
  await order("o-h-paid", "c1", "h", 2500, "PAID");
  // Giri: paid invoice 10 t @ 6500 and 4.321 t @ 6123; unpaid ones must not count.
  expectSales.g += await cinv("ci1", "o-PAID", "c2", "g", 10000, 650000, "PAID");
  await order("o-extra", "c1", "g", 4321, "PAID");
  expectSales.g += await cinv("ci2", "o-extra", "c1", "g", 4321, 612300, "PAID");
  await cinv("ci3", "o-INVOICED", "c1", "g", 6000, 650000, "ISSUED");
  await cinv("ci4", "o-DELIVERED", "c2", "g", 5000, 650000, "PAYMENT_REQUESTED");
  expectSales.h += await cinv("ci5", "o-h-paid", "c1", "h", 2500, 700000, "PAID");

  await order("o-pend", "c2", "pend", 1234, "PAID");
  expectSales.pend += await cinv("ci6", "o-pend", "c2", "pend", 1234, 600000, "PAID");
  // POs (Giri): counted = PLACED, ACCEPTED, DISPATCHED, INVOICED, PAID. Not counted: DRAFT (null provider), REJECTED.
  await po("p1", "g", "pa", 5000, "PLACED");
  await po("p2", "g", "pa", 2500, "ACCEPTED");
  await po("p3", "g", "pb", 7000, "DISPATCHED");
  await po("p4", "g", "pb", 1000, "INVOICED");
  await po("p5", "g", "pb", 500, "PAID");
  await po("p6", "g", null, null, "DRAFT");
  await po("p7", "g", "pa", 9999, "REJECTED");
  await po("p8", "g", "pa", 9998, "DRAFT");
  await po("p9", "h", "pa", 3000, "ACCEPTED");
  await po("p10", "pend", "pb", 1234, "ACCEPTED");
  for (const [id, poId, prov, dist, date, veh, ph] of [
    ["d1", "p3", "pb", "g", "2026-01-05", "TS09AB1234", "9876543210"],
    ["d2", "p4", "pb", "g", "2026-01-08", null, null],
    ["d3", "p5", "pb", "g", "2026-01-08", "KA01Z9999", null],
  ] as const) {
    await db.run(sql`INSERT INTO dispatches (id, po_id, provider_id, distributor_id, dispatch_date, vehicle_no, driver_phone, created_at) VALUES (${id}, ${poId}, ${prov}, ${dist}, ${date}, ${veh}, ${ph}, ${NOW + seq++})`);
  }
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("analytics routes: access", () => {
  it.each([["dist", "/api/admin/analytics/distributors"], ["disp", "/api/admin/dispatches"], ["cust", "/api/admin/customers"]])("%s: 401 anonymous, 403 non-admin, 200 admin", async (r, p) => {
    state.cookies.clear();
    expect((await get(r, p)).status).toBe(401);
    await as("g");
    expect((await get(r, p)).status).toBe(403);
    await as("admin");
    expect((await get(r, p)).status).toBe(200);
  });
  it("customer detail: 401 anonymous", async () => {
    state.cookies.clear();
    expect((await get("custId", "/x", "c1")).status).toBe(401);
  });
  it("customer detail: 403 non-admin, 404 unknown or non-customer, 400 bad id", async () => {
    await as("c1");
    expect((await get("custId", "/api/admin/customers/c1", "c1")).status).toBe(403);
    await as("admin");
    expect((await get("custId", "/x", "nope")).status).toBe(404);
    expect((await get("custId", "/x", "g")).status).toBe(404);
    expect((await get("custId", "/x", "bad id!")).status).toBe(400);
  });
});

describe("distributor analytics reconcile to the fixture", () => {
  it("sales = PAID customer invoices only; tonnes = placed+ POs only", async () => {
    await as("admin");
    const body = await (await get("dist", "/api/admin/analytics/distributors?limit=50")).json();
    const rows = body.data as Awaited<ReturnType<typeof svc.getDistributorAnalytics>>["rows"];
    expect(rows.map((r) => r.distributor).sort()).toEqual(["Giri", "Hari", "Idle"]); // PENDING distributor excluded
    const g = rows.find((r) => r.distributor === "Giri")!;
    expect(g.salesPaise).toBe(expectSales.g);
    expect(g.salesPaise).toBe(6500000 + Math.floor((4321 * 612300 + 500) / 1000));
    expect(g.paidInvoiceCount).toBe(2);
    expect(g.providers).toEqual([
      { providerId: "pb", provider: "Ambuja", qtyKg: 8500, poCount: 3 },
      { providerId: "pa", provider: "Anjani", qtyKg: 7500, poCount: 2 },
    ]);
    expect(g.orderedKg).toBe(16000);
    expect(g.providersTruncated).toBe(false);
    const h = rows.find((r) => r.distributor === "Hari")!;
    expect([h.salesPaise, h.orderedKg]).toEqual([expectSales.h, 3000]);
    const idle = rows.find((r) => r.distributor === "Idle")!;
    expect([idle.salesPaise, idle.orderedKg, idle.providers]).toEqual([0, 0, []]);
    expect(rows[0].distributor).toBe("Giri"); // highest sales first
    // Platform-wide: also includes the PENDING distributor "pend" (paid invoice + ACCEPTED PO), which has no row.
    expect(body.meta.totals).toEqual({ salesPaise: expectSales.g + expectSales.h + expectSales.pend, orderedKg: 19000 + 1234 });
    expect(body.meta.total).toBe(3);
  });
  it("page size is honoured; totals stay global", async () => {
    await as("admin");
    const body = await (await get("dist", "/api/admin/analytics/distributors?limit=1&page=2")).json();
    expect(body.data).toHaveLength(1);
    expect(body.meta.total).toBe(3);
    expect(body.meta.totals.orderedKg).toBe(19000 + 1234);
  });
});

describe("provider cap", () => {
  it("a low per-distributor cap truncates the list but orderedKg still covers every provider", async () => {
    await as("admin");
    const r = await svc.getDistributorAnalytics(db, { role: "ADMIN" }, { page: 1, limit: 50 }, 1);
    const g = r.rows.find((x) => x.distributor === "Giri")!;
    expect(g.providers).toEqual([{ providerId: "pb", provider: "Ambuja", qtyKg: 8500, poCount: 3 }]);
    expect(g.providersTruncated).toBe(true);
    expect(g.orderedKg).toBe(16000);
    expect(r.rows.find((x) => x.distributor === "Hari")!.providersTruncated).toBe(false);
  });
});

describe("dispatch list", () => {
  it("lists every dispatch newest first with vehicle, driver, PO and parties", async () => {
    await as("admin");
    const body = await (await get("disp", "/api/admin/dispatches")).json();
    expect(body.meta.total).toBe(3);
    expect(body.data.map((d: { id: string }) => d.id)).toEqual(["d3", "d2", "d1"]);
    expect(body.data[2]).toMatchObject({ poId: "p3", dispatchDate: "2026-01-05", vehicleNo: "TS09AB1234", driverPhone: "9876543210", qtyKg: 7000, distributor: "Giri", provider: "Ambuja" });
    expect(body.data[1]).toMatchObject({ vehicleNo: null, driverPhone: null });
  });
  it("paginates", async () => {
    await as("admin");
    const body = await (await get("disp", "/api/admin/dispatches?limit=2&page=2")).json();
    expect(body.data.map((d: { id: string }) => d.id)).toEqual(["d1"]);
  });
});

describe("customers", () => {
  it("list: order count (all statuses) and tonnes (excl. REJECTED/CANCELLED)", async () => {
    await as("admin");
    const body = await (await get("cust", "/api/admin/customers")).json();
    expect(body.meta.total).toBe(3);
    const by = Object.fromEntries(body.data.map((c: { customerId: string }) => [c.customerId, c]));
    // c1 (odd i): UNDER_REVIEW 2, DISPATCHED 4, INVOICED 6, REJECTED 8 (excluded); + o-h-paid 2.5 + o-extra 4.321
    expect(by.c1).toMatchObject({ customer: "Ramu Co", orderCount: 6, orderedKg: 2000 + 4000 + 6000 + 2500 + 4321 });
    // c2 (even i): REQUESTED 1, POS_PLACED 3, DELIVERED 5, PAID 7, CANCELLED 9 (excluded)
    expect(by.c2).toMatchObject({ customer: "N-c2", orderCount: 6, orderedKg: 1000 + 3000 + 5000 + 7000 + 1234 });
    expect(by.c3).toMatchObject({ orderCount: 0, orderedKg: 0 });
  });
  it("detail: full order history with status, tonnes and distributor", async () => {
    await as("admin");
    const body = await (await get("custId", "/x", "c1")).json();
    expect(body.meta.total).toBe(6);
    expect(body.data.customer).toBe("Ramu Co");
    const statuses = body.data.orders.map((o: { status: string }) => o.status).sort();
    expect(statuses).toEqual(["DISPATCHED", "INVOICED", "PAID", "PAID", "REJECTED", "UNDER_REVIEW"]);
    expect(body.data.orders.find((o: { orderId: string }) => o.orderId === "o-h-paid")).toMatchObject({ qtyKg: 2500, distributor: "Hari" });
    const empty = await (await get("custId", "/x", "c3")).json();
    expect(empty.data.orders).toEqual([]);
  });
});

describe("pagination caps", () => {
  it.each(["/api/admin/analytics/distributors", "/api/admin/dispatches", "/api/admin/customers"])("%s: page 1000 ok, 1001 / limit 51 / junk rejected", async (p) => {
    await as("admin");
    const r = p === "/api/admin/analytics/distributors" ? "dist" : p === "/api/admin/dispatches" ? "disp" : "cust";
    expect((await get(r, `${p}?page=1000`)).status).toBe(200);
    for (const q of ["page=1001", "limit=51", "limit=0", "page=0", "page=abc", "limit=-1"]) expect((await get(r, `${p}?${q}`)).status).toBe(400);
  });
  it("customer detail enforces the same caps", async () => {
    await as("admin");
    expect((await get("custId", "/x?page=1001", "c1")).status).toBe(400);
    expect((await get("custId", "/x?limit=51", "c1")).status).toBe(400);
  });
});

describe("service role guard", () => {
  it("rejects a non-admin actor even if a route is bypassed", async () => {
    await expect(svc.listAdminDispatches(db, { role: "DISTRIBUTOR" }, { page: 1, limit: 5 })).rejects.toMatchObject({ httpStatus: 403 });
  });
});
