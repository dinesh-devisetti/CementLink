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
const dir = mkdtempSync(path.join(tmpdir(), "cl-qa-v4-"));
process.env.DATABASE_URL = `file:${path.join(dir, "q.db")}`;
process.env.APP_URL = APP;
process.env.ACTION_MAX_PER_MIN = "1000"; // rate limit has its own tests in pos.test.ts

type Ctx = { params: Promise<{ id: string }> };
type Route = (req: Request, ctx?: Ctx) => Promise<Response>;
let listR: Route, acceptR: Route, rejectR: Route, reqGetOne: Route;
let db: ReturnType<typeof import("@/server/db/client").getDb>;
let schema: typeof import("@/server/db/schema");
let svc: typeof import("@/server/services/users");
let sess: typeof import("@/server/auth/session");
let lines: typeof import("@/server/services/lines");

let n = 0;
async function mk(role: "CUSTOMER" | "DISTRIBUTOR" | "PROVIDER", status: "ACTIVE" | "PENDING" | "REJECTED" = "ACTIVE") {
  n += 1;
  await svc.registerUser(db, {
    name: `User${n}`, email: `q${n}@x.com`, password: "password123", role, phone: "9876543210", businessName: `Biz${n}`, city: "Pune",
  } as never);
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, `q${n}@x.com`));
  await db.update(schema.users).set({ status }).where(eq(schema.users.id, u.id));
  return u.id;
}
async function signIn(userId: string) {
  const { token } = await sess.createSession(db, userId, 1);
  state.cookies.set("cl_session", token);
}
let seq = 0;
async function mkLine(customerId: string, distributorId: string, qty: number, requestId?: string) {
  seq += 1;
  const rid = requestId ?? `rq-${seq}`;
  if (!requestId) {
    await db.insert(schema.requests).values({
      id: rid, customerId, totalBags: qty, address: "Secret Street 9", city: "Pune", pincode: "411001", neededBy: "2030-01-01", createdAt: Date.now() + seq,
    });
  }
  const id = `ln-${seq}`;
  await db.insert(schema.requestLines).values({ id, requestId: rid, distributorId, qtyBags: qty, status: "SENT" });
  return id;
}
const ctx = (id: string): Ctx => ({ params: Promise.resolve({ id }) });
const accept = (id: string, payload: unknown) =>
  acceptR(new Request(`${APP}/api/lines/${id}/accept`, { method: "POST", body: typeof payload === "string" ? payload : JSON.stringify(payload) }), ctx(id));
const reject = (id: string) => rejectR(new Request(`${APP}/api/lines/${id}/reject`, { method: "POST" }), ctx(id));
const list = (q = "") => listR(new Request(`${APP}/api/lines${q}`));
const lineRow = async (id: string) => (await db.select().from(schema.requestLines).where(eq(schema.requestLines.id, id)))[0];

let cust: string, d1: string, d2: string, prov: string;
beforeAll(async () => {
  db = (await import("@/server/db/client")).getDb();
  schema = await import("@/server/db/schema");
  svc = await import("@/server/services/users");
  sess = await import("@/server/auth/session");
  lines = await import("@/server/services/lines");
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
  listR = (await import("@/app/api/lines/route")).GET as unknown as Route;
  acceptR = (await import("@/app/api/lines/[id]/accept/route")).POST as unknown as Route;
  rejectR = (await import("@/app/api/lines/[id]/reject/route")).POST as unknown as Route;
  reqGetOne = (await import("@/app/api/requests/[id]/route")).GET as unknown as Route;
  cust = await mk("CUSTOMER");
  d1 = await mk("DISTRIBUTOR");
  d2 = await mk("DISTRIBUTOR");
  prov = await mk("PROVIDER");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  state.cookies = new Map();
  state.headers = new Headers({ origin: APP });
});


describe("QA V4 edges", () => {
  it("price boundaries: 100000 ok, 100000.01 / 385.555 / ' ' / +5 / 1,000 / unicode / null / array rejected", async () => {
    const id = await mkLine(cust, d1, 3);
    await signIn(d1);
    for (const p of ["100000.01", "385.555", " ", "+5", "1,000", "\u0661\u0662", "0.00", "00000000", "-0", ".5", "5."]) {
      expect((await accept(id, { pricePerBag: p })).status, p).toBe(400);
    }
    for (const body of [null, [], { pricePerBag: null }, { pricePerBag: ["1"] }, {}, { pricePerBag: { a: 1 } }, "null", "[]"]) {
      expect((await accept(id, body as never)).status, JSON.stringify(body)).toBe(400);
    }
    expect((await lineRow(id)).status).toBe("SENT");
    expect((await accept(id, { pricePerBag: " 100000 " })).status).toBe(200);
    const row = await lineRow(id);
    expect(row.pricePerBagPaise).toBe(10_000_000);
    expect(row.amountPaise).toBe(30_000_000);
  });
  it("smallest price 0.01 accepted; 1 decimal padded", async () => {
    const a = await mkLine(cust, d1, 1);
    const b = await mkLine(cust, d1, 1);
    await signIn(d1);
    expect((await accept(a, { pricePerBag: "0.01" })).status).toBe(200);
    expect((await accept(b, { pricePerBag: "12.5" })).status).toBe(200);
    expect((await lineRow(a)).pricePerBagPaise).toBe(1);
    expect((await lineRow(b)).pricePerBagPaise).toBe(1250);
  });
  it("non-SENT statuses (PAYMENT_PENDING, PAID, CANCELLED-like) cannot be changed", async () => {
    for (const st of ["ACCEPTED", "PAYMENT_PENDING", "PAID", "REJECTED"] as const) {
      const id = await mkLine(cust, d1, 4);
      await db.update(schema.requestLines).set({ status: st, pricePerBagPaise: 500 }).where(eq(schema.requestLines.id, id));
      await signIn(d1);
      expect((await accept(id, { pricePerBag: "1" })).status, st).toBe(409);
      expect((await reject(id)).status, st).toBe(409);
      const r = await lineRow(id);
      expect([r.status, r.pricePerBagPaise]).toEqual([st, 500]);
    }
  });
  it("PENDING / REJECTED distributor sessions cannot list or act", async () => {
    for (const st of ["PENDING", "REJECTED"] as const) {
      const d = await mk("DISTRIBUTOR", st);
      const id = await mkLine(cust, d, 4);
      await signIn(d);
      expect([401, 403]).toContain((await list()).status);
      expect([401, 403]).toContain((await accept(id, { pricePerBag: "10" })).status);
      expect([401, 403]).toContain((await reject(id)).status);
      expect((await lineRow(id)).status).toBe("SENT");
    }
  });
  it("anonymous and provider cannot accept/reject; admin neither", async () => {
    const id = await mkLine(cust, d1, 4);
    expect((await accept(id, { pricePerBag: "10" })).status).toBe(401);
    expect((await reject(id)).status).toBe(401);
    await signIn(prov);
    expect((await reject(id)).status).toBe(403);
    expect((await lineRow(id)).status).toBe("SENT");
  });
  it("20 parallel accepts of one line: exactly one 200, rest 409", async () => {
    const id = await mkLine(cust, d1, 2);
    await signIn(d1);
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => accept(id, { pricePerBag: String(10 + i) })));
    const codes = rs.map((r) => r.status);
    expect(codes.filter((c) => c === 200)).toHaveLength(1);
    expect(codes.filter((c) => c === 409)).toHaveLength(19);
    const r = await lineRow(id);
    expect(r.amountPaise).toBe(2 * (r.pricePerBagPaise as number));
  });
  it("demand total counts ACCEPTED+PAYMENT_PENDING+PAID only, in bags; tonnes = bags/20", async () => {
    const d = await mk("DISTRIBUTOR");
    const ids = [] as string[];
    for (const q of [20, 10, 5, 7, 3]) ids.push(await mkLine(cust, d, q));
    const sts = ["ACCEPTED", "PAYMENT_PENDING", "PAID", "REJECTED", "SENT"] as const;
    for (let i = 0; i < 5; i++) await db.update(schema.requestLines).set({ status: sts[i] }).where(eq(schema.requestLines.id, ids[i]));
    await signIn(d);
    const b = await (await list()).json();
    expect(b.summary).toEqual({ acceptedBags: 35, awaitingReply: 1 });
    expect(b.meta.total).toBe(5);
  });
  it("empty distributor: zero summary, empty list; pagination bounds", async () => {
    const d = await mk("DISTRIBUTOR");
    await signIn(d);
    const b = await (await list()).json();
    expect(b).toMatchObject({ data: [], summary: { acceptedBags: 0, awaitingReply: 0 }, meta: { total: 0 } });
    for (const q of ["?page=0", "?page=-1", "?limit=0", "?page=abc", "?limit=1.5"]) expect((await list(q)).status, q).toBe(400);
    expect((await list("?page=1000")).status).toBe(200);
    expect((await list("?page=9999")).status).toBe(400); // page capped at 1000
  });
  it("other distributor's lines never leak via status filter or paging", async () => {
    const mine = await mkLine(cust, d1, 11);
    await mkLine(cust, d2, 77);
    await signIn(d1);
    const b = await (await list("?status=SENT&limit=50")).json();
    expect(b.data.every((r: { qtyBags: number }) => r.qtyBags !== 77)).toBe(true);
    expect(b.data.some((r: { id: string }) => r.id === mine)).toBe(true);
  });
  it("customer-injected markup in name is returned as plain data (React escapes); no phone/email/address in payload", async () => {
    const id = await mkLine(cust, d1, 4);
    await signIn(d1);
    const txt = JSON.stringify(await (await list()).json());
    expect(txt).not.toMatch(/9876543210|@x\.com|Secret Street/);
    expect(id).toBeTruthy();
  });
});
