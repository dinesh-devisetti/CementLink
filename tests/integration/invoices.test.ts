import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";
import { todayIst } from "@/lib/qty-input";

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
const dir = mkdtempSync(path.join(tmpdir(), "cl-inv-"));
process.env.DATABASE_URL = `file:${path.join(dir, "i.db")}`;
process.env.APP_URL = APP;
process.env.ACTION_MAX_PER_MIN = "100";

type Ctx = { params: Promise<{ id: string }> };
type Route = (req: Request, ctx?: Ctx) => Promise<Response>;
let invPost: Route, invGet: Route;
let db: ReturnType<typeof import("@/server/db/client").getDb>;
let schema: typeof import("@/server/db/schema");
let svc: typeof import("@/server/services/users");
let sess: typeof import("@/server/auth/session");
let inv: typeof import("@/server/services/invoices");

let n = 0;
async function mk(role: "CUSTOMER" | "DISTRIBUTOR" | "PROVIDER", status: "ACTIVE" | "PENDING" | "REJECTED" = "ACTIVE") {
  n += 1;
  await svc.registerUser(db, {
    name: `User${n}`, email: `i${n}@x.com`, password: "password123", role, phone: "9876543210", businessName: `Biz${n}`, city: "Pune",
  } as never);
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, `i${n}@x.com`));
  await db.update(schema.users).set({ status }).where(eq(schema.users.id, u.id));
  return u.id;
}
async function signIn(userId: string) {
  const { token } = await sess.createSession(db, userId, 1);
  state.cookies.set("cl_session", token);
}
let seq = 0;
async function mkPo(distributorId: string, providerId: string, qty = 100, status: "PLACED" | "CONFIRMED" | "REJECTED" = "CONFIRMED", createdAt = Date.now()) {
  seq += 1;
  const id = `po-inv-${seq}`;
  await db.insert(schema.purchaseOrders).values({
    id, distributorId, providerId, qtyBags: qty, ratePerBagPaise: 10000, totalPaise: qty * 10000, status, createdAt,
  });
  return id;
}
const ctx = (id: string): Ctx => ({ params: Promise.resolve({ id }) });
const body = (o: Record<string, unknown> = {}) => ({ invoiceNo: `INV-${++seq}`, invoiceDate: todayIst(), qtyBags: 10, ratePerBag: "100", ...o });
const post = (poId: string, payload: unknown) =>
  invPost(new Request(`${APP}/api/pos/${poId}/invoices`, { method: "POST", body: typeof payload === "string" ? payload : JSON.stringify(payload) }), ctx(poId));
const list = (q = "") => invGet(new Request(`${APP}/api/invoices${q}`));
const invRows = (poId: string) => db.select().from(schema.invoices).where(eq(schema.invoices.poId, poId));

let d1: string, d2: string, p1: string, p2: string, cust: string;
beforeAll(async () => {
  db = (await import("@/server/db/client")).getDb();
  schema = await import("@/server/db/schema");
  svc = await import("@/server/services/users");
  sess = await import("@/server/auth/session");
  inv = await import("@/server/services/invoices");
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
  invPost = (await import("@/app/api/pos/[id]/invoices/route")).POST as unknown as Route;
  invGet = (await import("@/app/api/invoices/route")).GET as unknown as Route;
  cust = await mk("CUSTOMER");
  d1 = await mk("DISTRIBUTOR");
  d2 = await mk("DISTRIBUTOR");
  p1 = await mk("PROVIDER");
  p2 = await mk("PROVIDER");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  state.cookies = new Map();
  state.headers = new Headers({ origin: APP });
});
afterEach(() => vi.useRealTimers());

describe("POST /api/pos/:id/invoices", () => {
  it("creates an invoice with server-computed amount, upper-cased number, denormalised distributor", async () => {
    const po = await mkPo(d1, p1);
    await signIn(p1);
    const res = await post(po, { invoiceNo: "inv-001", invoiceDate: todayIst(), qtyBags: 40, ratePerBag: "99.50" });
    expect(res.status).toBe(201);
    expect((await res.json()).data.amountPaise).toBe(40 * 9950);
    const [row] = await invRows(po);
    expect(row).toMatchObject({ invoiceNo: "INV-001", providerId: p1, distributorId: d1, qtyBags: 40, ratePerBagPaise: 9950, amountPaise: 398000 });
  });
  it("401 anon; 403 distributor/customer", async () => {
    const po = await mkPo(d1, p1);
    expect((await post(po, body())).status).toBe(401);
    await signIn(d1);
    expect((await post(po, body())).status).toBe(403);
    await signIn(cust);
    expect((await post(po, body())).status).toBe(403);
    expect(await invRows(po)).toHaveLength(0);
  });
  it("blocks cross-origin", async () => {
    const po = await mkPo(d1, p1);
    await signIn(p1);
    state.headers = new Headers({ origin: "http://evil.example" });
    expect((await post(po, body())).status).toBe(403);
  });
  it("partial supply allowed up to the PO qty; over-cap 422 with field error", async () => {
    const po = await mkPo(d1, p1, 100);
    await signIn(p1);
    expect((await post(po, body({ qtyBags: 60 }))).status).toBe(201);
    const over = await post(po, body({ qtyBags: 41 }));
    expect(over.status).toBe(422);
    const j = await over.json();
    expect(j.fields.qtyBags).toBe("Only 40 bags left to invoice");
    expect((await post(po, body({ qtyBags: 40 }))).status).toBe(201);
    const full = await post(po, body({ qtyBags: 1 }));
    expect(full.status).toBe(422);
    expect((await full.json()).fields.qtyBags).toMatch(/fully invoiced/);
    expect((await invRows(po)).reduce((s, r) => s + r.qtyBags, 0)).toBe(100);
  });
  it("race: concurrent invoices never exceed the PO qty", async () => {
    const po = await mkPo(d1, p1, 100);
    await signIn(p1);
    const codes = (await Promise.all([1, 2, 3, 4].map(() => post(po, body({ qtyBags: 40 }))))).map((r) => r.status).sort();
    expect(codes).toEqual([201, 201, 422, 422]);
    expect((await invRows(po)).reduce((s, r) => s + r.qtyBags, 0)).toBe(80);
  });
  it("409 on duplicate invoice number for the same provider (any PO, any case); other providers may reuse it", async () => {
    const a = await mkPo(d1, p1);
    const b = await mkPo(d2, p1);
    const c = await mkPo(d1, p2);
    await signIn(p1);
    expect((await post(a, body({ invoiceNo: "DUP-1" }))).status).toBe(201);
    const dup = await post(b, body({ invoiceNo: "dup-1" }));
    expect(dup.status).toBe(409);
    expect((await dup.json()).fields.invoiceNo).toBeTruthy();
    await signIn(p2);
    expect((await post(c, body({ invoiceNo: "DUP-1" }))).status).toBe(201);
  });
  it("409 unless PO is CONFIRMED", async () => {
    const placed = await mkPo(d1, p1, 100, "PLACED");
    const rejected = await mkPo(d1, p1, 100, "REJECTED");
    await signIn(p1);
    expect((await post(placed, body())).status).toBe(409);
    expect((await post(rejected, body())).status).toBe(409);
    expect(await invRows(placed)).toHaveLength(0);
  });
  it("404 for another provider's / unknown PO; 400 bad id", async () => {
    const po = await mkPo(d1, p1);
    await signIn(p2);
    expect((await post(po, body())).status).toBe(404);
    expect((await post("nope", body())).status).toBe(404);
    expect((await post("a/../b", body())).status).toBe(400);
    expect(await invRows(po)).toHaveLength(0);
  });
  it("403 when provider no longer ACTIVE (service level)", async () => {
    const p = await mk("PROVIDER");
    const po = await mkPo(d1, p);
    await db.update(schema.users).set({ status: "REJECTED" }).where(eq(schema.users.id, p));
    await expect(
      inv.createInvoice(db, p, po, { invoiceNo: "X1", invoiceDate: todayIst(), qtyBags: 1, ratePerBagPaise: 100 }),
    ).rejects.toMatchObject({ httpStatus: 403 });
  });
  it("400 on bad input, extra keys, client amount, bad JSON; 413 oversize", async () => {
    const po = await mkPo(d1, p1);
    await signIn(p1);
    for (const bad of [
      body({ qtyBags: 0 }), body({ qtyBags: -1 }), body({ qtyBags: 1.5 }), body({ qtyBags: "5" }), body({ qtyBags: 100_001 }),
      body({ ratePerBag: "0" }), body({ ratePerBag: "1.234" }), body({ ratePerBag: "100000.01" }), body({ ratePerBag: 10 }),
      body({ invoiceNo: "" }), body({ invoiceNo: "  " }), body({ invoiceNo: "A".repeat(41) }), body({ invoiceNo: "-lead" }), body({ invoiceNo: "a b" }), body({ invoiceNo: "<script>" }),
      body({ invoiceDate: "2026-02-30" }), body({ invoiceDate: "15/01/2026" }), body({ invoiceDate: "1999-12-31" }), body({ invoiceDate: "2999-01-01" }),
      { ...body(), amountPaise: 1 }, { ...body(), providerId: p2 }, { ...body(), poId: "x" }, {},
    ]) {
      expect((await post(po, bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await post(po, "{nope")).status).toBe(400);
    expect((await post(po, body({ invoiceNo: "1".repeat(20000) }))).status).toBe(413);
    expect(await invRows(po)).toHaveLength(0);
  });
  it("is rate limited per provider (429 + Retry-After)", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-06-01T10:00:05Z"));
    const p = await mk("PROVIDER");
    await signIn(p);
    const codes: number[] = [];
    for (let i = 0; i < 102; i += 1) codes.push((await post("nope", body())).status);
    expect(codes.slice(0, 100).every((c) => c === 404)).toBe(true);
    expect(codes.slice(100)).toEqual([429, 429]);
  });
});

describe("V6 fix round 1", () => {
  it("money cap rejects with RATE_EXCEEDS_PO and a ratePerBag field error; discounts and exact fit pass", async () => {
    const po = await mkPo(d1, p1, 100); // total Rs 10,000
    await signIn(p1);
    expect((await post(po, body({ qtyBags: 50, ratePerBag: "150" }))).status).toBe(201); // 7500
    const res = await post(po, body({ qtyBags: 50, ratePerBag: "60" })); // 3000 > 2500 left
    expect(res.status).toBe(422);
    const j = await res.json();
    expect(j.code).toBe("RATE_EXCEEDS_PO");
    expect(j.fields.ratePerBag).toMatch(/exceed/);
    expect((await post(po, body({ qtyBags: 50, ratePerBag: "50" }))).status).toBe(201); // exactly 2500
    expect((await invRows(po)).reduce((s, r) => s + r.amountPaise, 0)).toBe(1_000_000);
  });
  it("invoice date cannot precede the PO date (IST)", async () => {
    const po = await mkPo(d1, p1, 100, "CONFIRMED", Date.UTC(2026, 5, 10, 20, 0)); // 11 Jun 01:30 IST
    await signIn(p1);
    const early = await post(po, body({ invoiceDate: "2026-06-10" }));
    expect(early.status).toBe(422);
    expect((await early.json()).fields.invoiceDate).toMatch(/before the order date/);
    expect((await post(po, body({ invoiceDate: "2026-06-11" }))).status).toBe(201);
  });
  it("a unique violation on another index is not reported as a duplicate invoice number", async () => {
    const po = await mkPo(d1, p1, 100);
    const row = { poId: po, providerId: p1, distributorId: d1, invoiceDate: "2026-01-01", qtyBags: 1, ratePerBagPaise: 100, amountPaise: 100, createdAt: 1 };
    await db.insert(schema.invoices).values({ ...row, id: "same-id", invoiceNo: "PK-1" });
    await expect(db.insert(schema.invoices).values({ ...row, id: "same-id", invoiceNo: "PK-2" })).rejects.toThrow();
    const mk2 = (m: string) => Object.assign(new Error("wrapped"), { cause: new Error(m) });
    expect(inv.isUniqueViolation(mk2("UNIQUE constraint failed: invoices.id"))).toBe(false);
    expect(inv.isUniqueViolation(mk2("UNIQUE constraint failed: invoices.provider_id, invoices.invoice_no"))).toBe(true);
    expect(inv.isUniqueViolation(new Error("something else"))).toBe(false);
  });
  it("per-PO invoice lists are capped at 50 with the full count", async () => {
    const da = await mk("DISTRIBUTOR");
    const pa = await mk("PROVIDER");
    const po = await mkPo(da, pa, 1000);
    await db.insert(schema.invoices).values(
      Array.from({ length: 55 }, (_, i) => ({
        id: `cap-${i}`, poId: po, providerId: pa, distributorId: da, invoiceNo: `CAP-${i}`, invoiceDate: todayIst(),
        qtyBags: 1, ratePerBagPaise: 100, amountPaise: 100, createdAt: 1000 + i,
      })),
    );
    const detail = await inv.getPoForInvoice(db, pa, po);
    expect(detail?.invoices).toHaveLength(50);
    expect(detail?.invoiceCount).toBe(55);
    expect(detail?.invoices[0].invoiceNo).toBe("CAP-54");
    const g = (await inv.invoicesByPo(db, { id: da, role: "DISTRIBUTOR" }, [po]))[po];
    expect(g.total).toBe(55);
    expect(g.rows).toHaveLength(50);
    expect(g.rows[0].invoiceNo).toBe("CAP-54");
  });
  it("bagsToSupply = confirmed bags minus invoiced bags on confirmed POs", async () => {
    const pos = await import("@/server/services/pos");
    const da = await mk("DISTRIBUTOR");
    const pa = await mk("PROVIDER");
    const a = await mkPo(da, pa, 100);
    await mkPo(da, pa, 40, "PLACED");
    await mkPo(da, pa, 25, "REJECTED");
    await signIn(pa);
    await post(a, body({ qtyBags: 30 }));
    expect((await pos.providerSummary(db, pa)).bagsToSupply).toBe(70);
  });
});

describe("DB constraints", () => {
  it("rejects an invoice whose amount differs from qty x rate and a PO whose total differs", async () => {
    const po = await mkPo(d1, p1);
    await expect(
      db.insert(schema.invoices).values({
        id: "bad-amt", poId: po, providerId: p1, distributorId: d1, invoiceNo: "BAD1", invoiceDate: "2026-01-01",
        qtyBags: 2, ratePerBagPaise: 100, amountPaise: 999, createdAt: 1,
      }),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.purchaseOrders).values({
        id: "bad-total", distributorId: d1, providerId: p1, qtyBags: 2, ratePerBagPaise: 100, totalPaise: 1, status: "PLACED", createdAt: 1,
      }),
    ).rejects.toThrow();
  });
});

describe("GET /api/invoices isolation + totals", () => {
  it("provider sees only own; distributor sees only own received (read-only); others 403", async () => {
    const da = await mk("DISTRIBUTOR");
    const db2 = await mk("DISTRIBUTOR");
    const pa = await mk("PROVIDER");
    const pb = await mk("PROVIDER");
    const po1 = await mkPo(da, pa);
    const po2 = await mkPo(db2, pa);
    const po3 = await mkPo(da, pb);
    await signIn(pa);
    await post(po1, body({ qtyBags: 11 }));
    await post(po2, body({ qtyBags: 12 }));
    await signIn(pb);
    await post(po3, body({ qtyBags: 13 }));
    await signIn(pa);
    const mine = await (await list()).json();
    expect(mine.data.map((r: { qtyBags: number }) => r.qtyBags).sort()).toEqual([11, 12]);
    expect(mine.meta.total).toBe(2);
    await signIn(da);
    const recv = await (await list()).json();
    expect(recv.data.map((r: { qtyBags: number }) => r.qtyBags).sort()).toEqual([11, 13]);
    expect(Object.keys(recv.data[0]).sort()).not.toContain("providerId");
    await signIn(cust);
    expect((await list()).status).toBe(403);
    state.cookies = new Map();
    expect((await list()).status).toBe(401);
    // distributor cannot create
    await signIn(da);
    expect((await post(po1, body())).status).toBe(403);
  });
  it("paginates, caps page at 1000 and validates limit", async () => {
    await signIn(p1);
    expect((await list("?page=1001")).status).toBe(400);
    expect((await list("?limit=51")).status).toBe(400);
    expect((await list("?page=1&limit=1")).status).toBe(200);
  });
  it("totals per provider and per distributor are exact and isolated", async () => {
    const da = await mk("DISTRIBUTOR");
    const db2 = await mk("DISTRIBUTOR");
    const pa = await mk("PROVIDER");
    const pb = await mk("PROVIDER");
    const x = await mkPo(da, pa), y = await mkPo(da, pa), z = await mkPo(db2, pa), o = await mkPo(da, pb);
    await signIn(pa);
    await post(x, body({ qtyBags: 10, ratePerBag: "100" }));
    await post(y, body({ qtyBags: 5, ratePerBag: "200.50" }));
    await post(z, body({ qtyBags: 3, ratePerBag: "10" }));
    await signIn(pb);
    await post(o, body({ qtyBags: 99, ratePerBag: "1" }));
    expect(await inv.providerInvoiceTotals(db, pa)).toEqual({ invoiceCount: 3, bagsSold: 18, invoicedPaise: 100000 + 100250 + 3000 });
    const by = await inv.providerTotalsByDistributor(db, pa);
    expect(by.map((r) => [r.distributorId, r.bagsSold, r.invoicedPaise, r.invoiceCount])).toEqual([
      [da, 15, 200250, 2],
      [db2, 3, 3000, 1],
    ]);
    expect(await inv.providerInvoiceTotals(db, d1)).toEqual({ invoiceCount: 0, bagsSold: 0, invoicedPaise: 0 });
  });
  it("getPoForInvoice is scoped to the owning provider; invoicesByPo scoped to the actor", async () => {
    const da = await mk("DISTRIBUTOR");
    const pa = await mk("PROVIDER");
    const pb = await mk("PROVIDER");
    const po = await mkPo(da, pa, 50);
    await signIn(pa);
    await post(po, body({ qtyBags: 20 }));
    const detail = await inv.getPoForInvoice(db, pa, po);
    expect(detail).toMatchObject({ qtyBags: 50, invoicedBags: 20, remainingBags: 30, status: "CONFIRMED" });
    expect(detail?.invoices).toHaveLength(1);
    expect(await inv.getPoForInvoice(db, pb, po)).toBeNull();
    expect(Object.keys(await inv.invoicesByPo(db, { id: da, role: "DISTRIBUTOR" }, [po]))).toEqual([po]);
    expect(await inv.invoicesByPo(db, { id: d2, role: "DISTRIBUTOR" }, [po])).toEqual({});
    expect(await inv.invoicesByPo(db, { id: da, role: "DISTRIBUTOR" }, [])).toEqual({});
  });
});
