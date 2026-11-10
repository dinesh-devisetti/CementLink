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
const dir = mkdtempSync(path.join(tmpdir(), "cl-lines-"));
process.env.DATABASE_URL = `file:${path.join(dir, "l.db")}`;
process.env.APP_URL = APP;

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
    name: `User${n}`, email: `l${n}@x.com`, password: "password123", role, phone: "9876543210", businessName: `Biz${n}`, city: "Pune",
  } as never);
  const [u] = await db.select().from(schema.users).where(eq(schema.users.email, `l${n}@x.com`));
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

describe("GET /api/lines", () => {
  it("401 anon, 403 other roles", async () => {
    expect((await list()).status).toBe(401);
    await signIn(cust);
    expect((await list()).status).toBe(403);
    await signIn(prov);
    expect((await list()).status).toBe(403);
  });
  it("lists only own lines with minimal fields and a demand summary", async () => {
    const a = await mkLine(cust, d1, 30);
    await mkLine(cust, d2, 99);
    await signIn(d1);
    const res = await list();
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.map((r: { id: string }) => r.id)).toContain(a);
    expect(body.data.some((r: { qtyBags: number }) => r.qtyBags === 99)).toBe(false);
    const row = body.data.find((r: { id: string }) => r.id === a);
    expect(Object.keys(row).sort()).toEqual(
      ["amountPaise", "city", "createdAt", "customerName", "id", "neededBy", "pincode", "pricePerBagPaise", "qtyBags", "status"].sort(),
    );
    expect(JSON.stringify(body)).not.toContain("Secret Street");
    expect(JSON.stringify(body)).not.toContain("@x.com");
  });
  it("filters by status, validates query, sums demand", async () => {
    const d = await mk("DISTRIBUTOR");
    const l1 = await mkLine(cust, d, 20);
    const l2 = await mkLine(cust, d, 10);
    await mkLine(cust, d, 7);
    await signIn(d);
    await accept(l1, { pricePerBag: "300" });
    await reject(l2);
    const b = await (await list("?status=ACCEPTED")).json();
    expect(b.data).toHaveLength(1);
    expect(b.summary).toEqual({ acceptedBags: 20, awaitingReply: 1 });
    expect(b.meta.total).toBe(1);
    expect((await list("?status=BOGUS")).status).toBe(400);
    expect((await list("?limit=500")).status).toBe(400);
  });
});

describe("accept / reject", () => {
  it("accepts with price, computes amount in paise and customer sees status", async () => {
    const id = await mkLine(cust, d1, 30);
    await signIn(d1);
    const res = await accept(id, { pricePerBag: "385.50" });
    expect(res.status).toBe(200);
    const row = await lineRow(id);
    expect(row.status).toBe("ACCEPTED");
    expect(row.pricePerBagPaise).toBe(38550);
    expect(row.amountPaise).toBe(30 * 38550);
    expect(row.acceptedAt).not.toBeNull();
    await signIn(cust);
    const view = await (await reqGetOne(new Request(`${APP}/api/requests/rq-${seq}`), ctx(`rq-${seq}`))).json();
    expect(view.data.lines[0]).toMatchObject({ status: "ACCEPTED", pricePerBagPaise: 38550 });
  });
  it("rejects a SENT line", async () => {
    const id = await mkLine(cust, d1, 5);
    await signIn(d1);
    expect((await reject(id)).status).toBe(200);
    expect((await lineRow(id)).status).toBe("REJECTED");
  });
  it("409 on second transition; no overwrite", async () => {
    const id = await mkLine(cust, d1, 5);
    await signIn(d1);
    await accept(id, { pricePerBag: "100" });
    expect((await accept(id, { pricePerBag: "999" })).status).toBe(409);
    expect((await reject(id)).status).toBe(409);
    expect((await lineRow(id)).pricePerBagPaise).toBe(10000);
    const id2 = await mkLine(cust, d1, 5);
    await reject(id2);
    expect((await accept(id2, { pricePerBag: "100" })).status).toBe(409);
  });
  it("race: concurrent accept and reject yields exactly one winner", async () => {
    const id = await mkLine(cust, d1, 8);
    await signIn(d1);
    const [a, b] = await Promise.all([accept(id, { pricePerBag: "50" }), reject(id)]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    const row = await lineRow(id);
    expect(row.amountPaise).toBe(row.status === "ACCEPTED" ? 400 : null);
  });
  it("404 for another distributor's or unknown line; row untouched", async () => {
    const id = await mkLine(cust, d2, 5);
    await signIn(d1);
    expect((await accept(id, { pricePerBag: "100" })).status).toBe(404);
    expect((await reject(id)).status).toBe(404);
    expect((await accept("nope", { pricePerBag: "100" })).status).toBe(404);
    expect((await lineRow(id)).status).toBe("SENT");
  });
  it("400 on bad price, extra keys, bad JSON; 413 oversize", async () => {
    const id = await mkLine(cust, d1, 5);
    await signIn(d1);
    for (const p of ["0", "-5", "abc", "1.234", "99999999", "", "1e3"]) {
      expect((await accept(id, { pricePerBag: p })).status, p).toBe(400);
    }
    expect((await accept(id, { pricePerBag: 100 })).status).toBe(400);
    expect((await accept(id, { pricePerBag: "100", amountPaise: 1 })).status).toBe(400);
    expect((await accept(id, "{nope")).status).toBe(400);
    expect((await accept(id, { pricePerBag: "1".repeat(20000) })).status).toBe(413);
    expect((await lineRow(id)).status).toBe("SENT");
  });
  it("blocks wrong roles, missing origin, bad id", async () => {
    const id = await mkLine(cust, d1, 5);
    await signIn(cust);
    expect((await accept(id, { pricePerBag: "100" })).status).toBe(403);
    await signIn(d1);
    state.headers = new Headers({ origin: "http://evil.example" });
    expect((await reject(id)).status).toBe(403);
    state.headers = new Headers({ origin: APP });
    expect((await reject("a/../b")).status).toBe(400);
    expect((await lineRow(id)).status).toBe("SENT");
  });
  it("service refuses when the distributor is no longer ACTIVE", async () => {
    const d = await mk("DISTRIBUTOR");
    const id = await mkLine(cust, d, 5);
    await db.update(schema.users).set({ status: "REJECTED" }).where(eq(schema.users.id, d));
    await expect(lines.acceptLine(db, d, id, 100)).rejects.toMatchObject({ httpStatus: 403 });
    await expect(lines.rejectLine(db, d, id)).rejects.toMatchObject({ httpStatus: 403 });
    expect((await lineRow(id)).status).toBe("SENT");
    await expect(lines.acceptLine(db, d, id, 0)).rejects.toMatchObject({ httpStatus: 400 });
  });
});
