import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq } from "drizzle-orm";

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
const dir = mkdtempSync(path.join(tmpdir(), "cl-qa-v5-"));
process.env.DATABASE_URL = `file:${path.join(dir, "q5.db")}`;
process.env.APP_URL = APP;
process.env.ACTION_MAX_PER_MIN = "1000";

type Ctx = { params: Promise<{ id: string }> };
type Route = (req: Request, ctx?: Ctx) => Promise<Response>;
let posPost: Route, posGet: Route, confirmR: Route, rejectR: Route, provGet: Route, acceptR: Route, rejectLineR: Route, linesGet: Route;
let db: ReturnType<typeof import("@/server/db/client").getDb>;
let schema: typeof import("@/server/db/schema");
let svc: typeof import("@/server/services/users");
let sess: typeof import("@/server/auth/session");

let n = 0;
async function mk(role: "CUSTOMER" | "DISTRIBUTOR" | "PROVIDER", status: "ACTIVE" | "PENDING" | "REJECTED" = "ACTIVE") {
  n += 1;
  await svc.registerUser(db, {
    name: `User${n}`, email: `v5${n}@x.com`, password: "password123", role, phone: "9876543210", businessName: `Biz${n}`, city: "Pune",
  } as never);
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, `v5${n}@x.com`));
  await db.update(schema.users).set({ status }).where(eq(schema.users.id, u.id));
  return u.id;
}
async function signIn(userId: string) {
  const { token } = await sess.createSession(db, userId, 1);
  state.cookies.set("cl_session", token);
}
let seq = 0;
async function mkLine(customerId: string, distributorId: string, qty: number, status = "ACCEPTED") {
  seq += 1;
  await db.insert(schema.requests).values({
    id: `vrq-${seq}`, customerId, totalBags: qty, address: "A", city: "Pune", pincode: "411001", neededBy: "2030-01-01", createdAt: Date.now(),
  });
  const id = `vln-${seq}`;
  await db.insert(schema.requestLines).values({ id, requestId: `vrq-${seq}`, distributorId, qtyBags: qty, status: status as never });
  return id;
}
const ctx = (id: string): Ctx => ({ params: Promise.resolve({ id }) });
const create = (payload: unknown) =>
  posPost(new Request(`${APP}/api/pos`, { method: "POST", body: typeof payload === "string" ? payload : JSON.stringify(payload) }));
const confirm = (id: string) => confirmR(new Request(`${APP}/api/pos/${id}/confirm`, { method: "POST" }), ctx(id));
const rejectPo = (id: string) => rejectR(new Request(`${APP}/api/pos/${id}/reject`, { method: "POST" }), ctx(id));
const list = (q = "") => posGet(new Request(`${APP}/api/pos${q}`));
const poRow = async (id: string) => (await db.select().from(schema.purchaseOrders).where(eq(schema.purchaseOrders.id, id)))[0];

let cust: string, d1: string, d2: string, p1: string, p2: string;
beforeAll(async () => {
  db = (await import("@/server/db/client")).getDb();
  schema = await import("@/server/db/schema");
  svc = await import("@/server/services/users");
  sess = await import("@/server/auth/session");
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
  const r = await import("@/app/api/pos/route");
  posPost = r.POST as unknown as Route;
  posGet = r.GET as unknown as Route;
  confirmR = (await import("@/app/api/pos/[id]/confirm/route")).POST as unknown as Route;
  rejectR = (await import("@/app/api/pos/[id]/reject/route")).POST as unknown as Route;
  provGet = (await import("@/app/api/providers/route")).GET as unknown as Route;
  acceptR = (await import("@/app/api/lines/[id]/accept/route")).POST as unknown as Route;
  rejectLineR = (await import("@/app/api/lines/[id]/reject/route")).POST as unknown as Route;
  linesGet = (await import("@/app/api/lines/route")).GET as unknown as Route;
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


const rawCreate = (providerId: string, qtyBags: unknown, ratePerBag: unknown) => create({ providerId, qtyBags, ratePerBag });

describe("QA V5 PO create bounds", () => {
  it("qty bounds: 0, -1, 1.5, '5', null, 100001 -> 400; 1 and 100000 -> 201", async () => {
    await signIn(d1);
    for (const q of [0, -1, 1.5, "5", null, 100001, 1e21, NaN]) expect((await rawCreate(p1, q, "100")).status, String(q)).toBe(400);
    expect((await rawCreate(p1, 1, "100")).status).toBe(201);
    const r = await rawCreate(p1, 100000, "100000");
    expect(r.status).toBe(201);
    expect((await r.json()).data.totalPaise).toBe(100000 * 10000000);
  });
  it("rate formats: bad -> 400; 0.01 and 100000 ok", async () => {
    await signIn(d1);
    for (const x of ["0", "0.00", "-1", "1.234", "abc", "", " ", "1e3", "1,000", "+5", ".5", "5.", "100000.01", 385, null, [], {}, "\u0661\u0662"]) {
      expect((await rawCreate(p1, 10, x)).status, JSON.stringify(x)).toBe(400);
    }
    const ok = await rawCreate(p1, 3, "0.01");
    expect(ok.status).toBe(201);
    expect((await ok.json()).data.totalPaise).toBe(3);
  });
  it("providerId bad shapes -> 400/422; extra keys and client totalPaise ignored/rejected", async () => {
    await signIn(d1);
    for (const x of [null, 5, "", "../x", "x".repeat(200), [], {}]) expect([400, 422], JSON.stringify(x)).toContain((await rawCreate(x as never, 5, "10")).status);
    expect((await create({ providerId: p1, qtyBags: 5, ratePerBag: "10", totalPaise: 1 })).status).toBe(400);
    expect((await create({ providerId: p1, qtyBags: 5, ratePerBag: "10", status: "CONFIRMED" })).status).toBe(400);
    expect((await create([])).status).toBe(400);
  });
  it("distributor id as providerId, customer id, admin-ish and own id -> 422", async () => {
    await signIn(d1);
    for (const id of [d1, d2, cust]) expect((await rawCreate(id, 5, "10")).status).toBe(422);
  });
  it("admin, anon -> 403/401 on all PO endpoints", async () => {
    const admin = await mk("CUSTOMER");
    await db.update(schema.users).set({ role: "ADMIN" as never }).where(eq(schema.users.id, admin));
    await signIn(admin);
    expect((await rawCreate(p1, 5, "10")).status).toBe(403);
    expect((await list()).status).toBe(403);
    expect((await confirm("x")).status).toBe(403);
    expect((await rejectPo("x")).status).toBe(403);
    state.cookies = new Map();
    expect((await rawCreate(p1, 5, "10")).status).toBe(401);
    expect((await list()).status).toBe(401);
    expect((await confirm("x")).status).toBe(401);
    expect((await provGet(new Request(`${APP}/api/providers`))).status).toBe(401);
  });
  it("PENDING / REJECTED distributor session cannot create", async () => {
    for (const s of ["PENDING", "REJECTED"] as const) {
      const d = await mk("DISTRIBUTOR", s);
      await signIn(d);
      expect([401, 403]).toContain((await rawCreate(p1, 5, "10")).status);
    }
  });
});

describe("QA V5 over-order math", () => {
  it("accepted 30; PO 20 -> 0 over; PO 20 more -> 10 over; PO 5 more -> 5 over; ignores SENT/REJECTED lines and other distributors", async () => {
    const d = await mk("DISTRIBUTOR");
    const other = await mk("DISTRIBUTOR");
    await mkLine(cust, d, 10, "ACCEPTED");
    await mkLine(cust, d, 20, "PAID");
    await mkLine(cust, d, 500, "SENT");
    await mkLine(cust, d, 500, "REJECTED");
    await mkLine(cust, other, 900, "ACCEPTED");
    await signIn(d);
    const a = await (await rawCreate(p1, 20, "10")).json();
    expect(a.data.overOrderBags).toBe(0);
    const b = await (await rawCreate(p1, 20, "10")).json();
    expect(b.data.overOrderBags).toBe(10);
    const c = await (await rawCreate(p2, 5, "10")).json();
    expect(c.data.overOrderBags).toBe(5);
  });
  it("no accepted demand at all -> full qty is over, still 201", async () => {
    const d = await mk("DISTRIBUTOR");
    await signIn(d);
    const r = await rawCreate(p1, 7, "10");
    expect(r.status).toBe(201);
    expect((await r.json()).data.overOrderBags).toBe(7);
  });
});

describe("QA V5 provider visibility and transitions", () => {
  it("many distributors -> one provider; provider sees all, other provider none, rejected stays visible", async () => {
    const pv = await mk("PROVIDER");
    const pw = await mk("PROVIDER");
    const ds = [await mk("DISTRIBUTOR"), await mk("DISTRIBUTOR"), await mk("DISTRIBUTOR")];
    const ids: string[] = [];
    for (const d of ds) {
      await signIn(d);
      ids.push((await (await rawCreate(pv, 5, "10")).json()).data.id);
    }
    await signIn(pv);
    const got = (await (await list()).json()).data.map((r: { id: string }) => r.id);
    expect(got.sort()).toEqual([...ids].sort());
    await signIn(pw);
    expect((await (await list()).json()).data).toHaveLength(0);
    expect((await confirm(ids[0])).status).toBe(404);
    expect((await poRow(ids[0])).status).toBe("PLACED");
    await signIn(pv);
    await rejectPo(ids[0]);
    expect((await (await list()).json()).meta.total).toBe(3);
  });
  it("REJECTED -> confirm 409, CONFIRMED -> reject 409, unchanged", async () => {
    const d = await mk("DISTRIBUTOR");
    await signIn(d);
    const a = (await (await rawCreate(p1, 5, "10")).json()).data.id;
    const b = (await (await rawCreate(p1, 5, "10")).json()).data.id;
    await signIn(p1);
    await rejectPo(a);
    await confirm(b);
    expect((await confirm(a)).status).toBe(409);
    expect((await rejectPo(b)).status).toBe(409);
    expect((await poRow(a)).status).toBe("REJECTED");
    expect((await poRow(b)).status).toBe("CONFIRMED");
  });
  it("10 parallel confirm+reject mix: exactly one 200", async () => {
    const d = await mk("DISTRIBUTOR");
    await signIn(d);
    const id = (await (await rawCreate(p1, 5, "10")).json()).data.id;
    await signIn(p1);
    const rs = await Promise.all(Array.from({ length: 10 }, (_, i) => (i % 2 ? confirm(id) : rejectPo(id))));
    const codes = rs.map((r) => r.status);
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(9);
  });
  it("distributor cannot confirm own PO; deactivated provider cannot create-view-confirm", async () => {
    const d = await mk("DISTRIBUTOR");
    const pv = await mk("PROVIDER");
    await signIn(d);
    const id = (await (await rawCreate(pv, 5, "10")).json()).data.id;
    expect((await confirm(id)).status).toBe(403);
    await db.update(schema.users).set({ status: "REJECTED" }).where(eq(schema.users.id, pv));
    expect((await rawCreate(pv, 5, "10")).status).toBe(422);
    expect((await (await provGet(new Request(`${APP}/api/providers`))).json()).data.map((p: { id: string }) => p.id)).not.toContain(pv);
  });
  it("paging: page 1001 and limit 51 -> 400; page 2 returns remainder; page 0 -> 400", async () => {
    const d = await mk("DISTRIBUTOR");
    await signIn(d);
    for (let i = 0; i < 3; i++) await rawCreate(p2, 1 + i, "10");
    expect((await list("?page=1001")).status).toBe(400);
    expect((await list("?limit=51")).status).toBe(400);
    expect((await list("?page=0")).status).toBe(400);
    const r = await (await list("?limit=2&page=2")).json();
    expect(r.data).toHaveLength(1);
    expect(r.meta.total).toBe(3);
  });
  it("response never leaks counterparty email/phone", async () => {
    await signIn(p1);
    const txt = JSON.stringify(await (await list()).json());
    expect(txt).not.toMatch(/@x\.com|9876543210|password/i);
  });
});
