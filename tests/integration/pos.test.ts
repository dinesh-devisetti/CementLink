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
const dir = mkdtempSync(path.join(tmpdir(), "cl-pos-"));
process.env.DATABASE_URL = `file:${path.join(dir, "p.db")}`;
process.env.APP_URL = APP;
process.env.ACTION_MAX_PER_MIN = "20";

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
    name: `User${n}`, email: `p${n}@x.com`, password: "password123", role, phone: "9876543210", businessName: `Biz${n}`, city: "Pune",
  } as never);
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, `p${n}@x.com`));
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
    id: `prq-${seq}`, customerId, totalBags: qty, address: "A", city: "Pune", pincode: "411001", neededBy: "2030-01-01", createdAt: Date.now(),
  });
  const id = `pln-${seq}`;
  await db.insert(schema.requestLines).values({ id, requestId: `prq-${seq}`, distributorId, qtyBags: qty, status: status as never });
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

describe("POST /api/pos", () => {
  it("401 anon; 403 customer and provider", async () => {
    expect((await create({})).status).toBe(401);
    await signIn(cust);
    expect((await create({})).status).toBe(403);
    await signIn(p1);
    expect((await create({})).status).toBe(403);
  });
  it("creates PLACED PO with server-computed total in paise", async () => {
    const d = await mk("DISTRIBUTOR");
    await signIn(d);
    const res = await create({ providerId: p1, qtyBags: 40, ratePerBag: "385.50" });
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data).toMatchObject({ status: "PLACED", totalPaise: 40 * 38550, overOrderBags: 40 });
    const row = await poRow(data.id);
    expect(row).toMatchObject({ distributorId: d, providerId: p1, qtyBags: 40, ratePerBagPaise: 38550, totalPaise: 1542000, status: "PLACED" });
  });
  it("over-order warning only when qty exceeds unfulfilled accepted demand (still allowed)", async () => {
    const d = await mk("DISTRIBUTOR");
    await mkLine(cust, d, 30);
    await mkLine(cust, d, 50, "SENT"); // not accepted: does not count
    await signIn(d);
    const a = await (await create({ providerId: p1, qtyBags: 20, ratePerBag: "100" })).json();
    expect(a.data.overOrderBags).toBe(0);
    const b = await (await create({ providerId: p2, qtyBags: 25, ratePerBag: "100" })).json();
    expect(b.data.overOrderBags).toBe(15); // 10 bags unfulfilled left
    const c = await (await create({ providerId: p2, qtyBags: 1, ratePerBag: "100" })).json();
    expect(c.data.overOrderBags).toBe(1); // already stocked ahead
  });
  it("rejected POs free up demand again", async () => {
    const d = await mk("DISTRIBUTOR");
    await mkLine(cust, d, 30);
    await signIn(d);
    const a = await (await create({ providerId: p1, qtyBags: 30, ratePerBag: "100" })).json();
    await signIn(p1);
    expect((await rejectPo(a.data.id)).status).toBe(200);
    await signIn(d);
    expect((await (await create({ providerId: p1, qtyBags: 30, ratePerBag: "100" })).json()).data.overOrderBags).toBe(0);
  });
  it("422 for pending/rejected/non-provider/unknown provider; nothing inserted", async () => {
    const d = await mk("DISTRIBUTOR");
    const pend = await mk("PROVIDER", "PENDING");
    const rej = await mk("PROVIDER", "REJECTED");
    await signIn(d);
    for (const id of [pend, rej, cust, d2, "nope"]) {
      expect((await create({ providerId: id, qtyBags: 5, ratePerBag: "10" })).status, id).toBe(422);
    }
    expect((await list()).status).toBe(200);
    expect((await (await list()).json()).meta.total).toBe(0);
  });
  it("403 when the distributor is no longer ACTIVE", async () => {
    const d = await mk("DISTRIBUTOR");
    await signIn(d);
    await db.update(schema.users).set({ status: "REJECTED" }).where(eq(schema.users.id, d));
    // session survives on this path only if requireRole allows; either 401/403 blocks creation
    const res = await create({ providerId: p1, qtyBags: 5, ratePerBag: "10" });
    expect([401, 403]).toContain(res.status);
    const svcPos = await import("@/server/services/pos");
    await expect(svcPos.createPo(db, d, { providerId: p1, qtyBags: 5, ratePerBagPaise: 1000 })).rejects.toMatchObject({ httpStatus: 403 });
  });
  it("400 on bad qty, rate, extra keys, client total, bad JSON; 413 oversize", async () => {
    const d = await mk("DISTRIBUTOR");
    await signIn(d);
    const ok = { providerId: p1, qtyBags: 5, ratePerBag: "10" };
    for (const bad of [
      { ...ok, qtyBags: 0 }, { ...ok, qtyBags: -1 }, { ...ok, qtyBags: 1.5 }, { ...ok, qtyBags: "5" }, { ...ok, qtyBags: 100_001 },
      { ...ok, ratePerBag: "0" }, { ...ok, ratePerBag: "-5" }, { ...ok, ratePerBag: "1.234" }, { ...ok, ratePerBag: "100000.01" }, { ...ok, ratePerBag: 10 },
      { ...ok, totalPaise: 1 }, { ...ok, distributorId: d2 }, { ...ok, providerId: "a/../b" }, {},
    ]) {
      expect((await create(bad)).status, JSON.stringify(bad)).toBe(400);
    }
    expect((await create("{nope")).status).toBe(400);
    expect((await create({ ...ok, ratePerBag: "1".repeat(20000) })).status).toBe(413);
    expect((await (await list()).json()).meta.total).toBe(0);
  });
  it("blocks cross-origin", async () => {
    await signIn(d1);
    state.headers = new Headers({ origin: "http://evil.example" });
    expect((await create({ providerId: p1, qtyBags: 5, ratePerBag: "10" })).status).toBe(403);
  });
  it("is rate limited per actor (429 + Retry-After), other actors unaffected", async () => {
    const d = await mk("DISTRIBUTOR");
    await signIn(d);
    const ok = { providerId: p1, qtyBags: 1, ratePerBag: "10" };
    for (let i = 0; i < 20; i += 1) expect((await create(ok)).status).toBe(201);
    const res = await create(ok);
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBeTruthy();
    await signIn(d2);
    expect((await create(ok)).status).toBe(201);
  });
});

describe("GET /api/pos isolation and pagination", () => {
  it("distributor sees only own POs; provider sees only received, from many distributors", async () => {
    const da = await mk("DISTRIBUTOR");
    const db2 = await mk("DISTRIBUTOR");
    const pa = await mk("PROVIDER");
    const pb = await mk("PROVIDER");
    await signIn(da);
    await create({ providerId: pa, qtyBags: 11, ratePerBag: "10" });
    await create({ providerId: pb, qtyBags: 12, ratePerBag: "10" });
    await signIn(db2);
    await create({ providerId: pa, qtyBags: 13, ratePerBag: "10" });
    await signIn(da);
    const mine = await (await list()).json();
    expect(mine.data.map((r: { qtyBags: number }) => r.qtyBags).sort()).toEqual([11, 12]);
    expect(mine.data[0].counterparty).toMatch(/^Biz/);
    await signIn(pa);
    const recv = await (await list()).json();
    expect(recv.data.map((r: { qtyBags: number }) => r.qtyBags).sort()).toEqual([11, 13]);
    expect(Object.keys(recv.data[0]).sort()).toEqual(["counterparty", "createdAt", "id", "qtyBags", "ratePerBagPaise", "status", "totalPaise"]);
    expect(JSON.stringify(recv)).not.toContain("@x.com");
    await signIn(cust);
    expect((await list()).status).toBe(403);
  });
  it("paginates and caps page at 1000, limit at 50", async () => {
    const d = await mk("DISTRIBUTOR");
    await signIn(d);
    for (let i = 0; i < 3; i += 1) await create({ providerId: p2, qtyBags: i + 1, ratePerBag: "10" });
    const p2r = await (await list("?limit=2&page=2")).json();
    expect(p2r.data).toHaveLength(1);
    expect(p2r.meta).toEqual({ total: 3, page: 2, limit: 2 });
    expect((await list("?page=1000")).status).toBe(200);
    for (const q of ["?page=1001", "?page=0", "?limit=51", "?limit=0", "?page=abc"]) expect((await list(q)).status, q).toBe(400);
  });
});

describe("confirm / reject", () => {
  async function placed(dist = d1, prov = p1) {
    await signIn(dist);
    const body = await (await create({ providerId: prov, qtyBags: 3, ratePerBag: "10" })).json();
    return body.data.id as string;
  }
  it("provider confirms and rejects own PLACED PO; distributor sees status", async () => {
    const a = await placed();
    const b = await placed();
    await signIn(p1);
    expect((await confirm(a)).status).toBe(200);
    expect((await rejectPo(b)).status).toBe(200);
    expect((await poRow(a)).status).toBe("CONFIRMED");
    expect((await poRow(b)).status).toBe("REJECTED");
    await signIn(d1);
    const rows = (await (await list("?limit=50")).json()).data as Array<{ id: string; status: string }>;
    expect(rows.find((r) => r.id === a)?.status).toBe("CONFIRMED");
  });
  it("409 on second transition, no overwrite", async () => {
    const a = await placed();
    await signIn(p1);
    await confirm(a);
    expect((await confirm(a)).status).toBe(409);
    expect((await rejectPo(a)).status).toBe(409);
    expect((await poRow(a)).status).toBe("CONFIRMED");
  });
  it("race: concurrent confirm and reject yields one winner", async () => {
    const a = await placed();
    await signIn(p1);
    const [x, y] = await Promise.all([confirm(a), rejectPo(a)]);
    expect([x.status, y.status].sort()).toEqual([200, 409]);
  });
  it("404 for another provider's / unknown PO; 403 distributor/customer; 400 bad id", async () => {
    const a = await placed(d1, p1);
    await signIn(p2);
    expect((await confirm(a)).status).toBe(404);
    expect((await rejectPo(a)).status).toBe(404);
    expect((await confirm("nope")).status).toBe(404);
    expect((await confirm("a/../b")).status).toBe(400);
    await signIn(d1);
    expect((await confirm(a)).status).toBe(403);
    await signIn(cust);
    expect((await rejectPo(a)).status).toBe(403);
    expect((await poRow(a)).status).toBe("PLACED");
  });
  it("403 when provider no longer ACTIVE (service level)", async () => {
    const p = await mk("PROVIDER");
    const a = await placed(d1, p);
    await db.update(schema.users).set({ status: "REJECTED" }).where(eq(schema.users.id, p));
    const svcPos = await import("@/server/services/pos");
    await expect(svcPos.decidePo(db, p, a, "CONFIRMED")).rejects.toMatchObject({ httpStatus: 403 });
    expect((await poRow(a)).status).toBe("PLACED");
  });
  it("is rate limited per provider", async () => {
    const p = await mk("PROVIDER");
    await signIn(p);
    const codes: number[] = [];
    for (let i = 0; i < 22; i += 1) codes.push((await confirm("nope")).status);
    expect(codes.slice(0, 20).every((c) => c === 404)).toBe(true);
    expect(codes.slice(20)).toEqual([429, 429]);
  });
});

describe("GET /api/providers", () => {
  it("lists ACTIVE providers only for distributors", async () => {
    await signIn(d1);
    const body = await (await provGet(new Request(`${APP}/api/providers`))).json();
    const ids = body.data.map((p: { id: string }) => p.id);
    expect(ids).toContain(p1);
    expect(ids).not.toContain(cust);
    expect(Object.keys(body.data[0]).sort()).toEqual(["businessName", "city", "id"]);
    await signIn(cust);
    expect((await provGet(new Request(`${APP}/api/providers`))).status).toBe(403);
  });
});

describe("V4 deferred: accept/reject limit and page cap", () => {
  it("accept/reject share a per-distributor limit, 429 after the cap", async () => {
    const d = await mk("DISTRIBUTOR");
    await signIn(d);
    const codes: number[] = [];
    for (let i = 0; i < 22; i += 1) {
      codes.push((await (i % 2 ? rejectLineR : acceptR)(new Request(`${APP}/api/lines/nope/x`, { method: "POST", body: JSON.stringify({ pricePerBag: "10" }) }), ctx("nope"))).status);
    }
    expect(codes.slice(0, 20).every((c) => c === 404)).toBe(true);
    expect(codes.slice(20)).toEqual([429, 429]);
  });
  it("GET /api/lines caps page at 1000", async () => {
    await signIn(d2);
    expect((await linesGet(new Request(`${APP}/api/lines?page=1000`))).status).toBe(200);
    expect((await linesGet(new Request(`${APP}/api/lines?page=1001`))).status).toBe(400);
  });
});
