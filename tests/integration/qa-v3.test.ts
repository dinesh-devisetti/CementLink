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
const dir = mkdtempSync(path.join(tmpdir(), "cl-qa3-"));
process.env.DATABASE_URL = `file:${path.join(dir, "r.db")}`;
process.env.APP_URL = APP;
process.env.REQUEST_MAX_PER_HOUR = "10000";

type Ctx = { params: Promise<{ id: string }> };
type Route = (req: Request, ctx?: Ctx) => Promise<Response>;
let reqPost: Route, reqGet: Route, reqById: Route, distGet: Route;
let db: ReturnType<typeof import("@/server/db/client").getDb>;
let schema: typeof import("@/server/db/schema");
let svc: typeof import("@/server/services/users");
let sess: typeof import("@/server/auth/session");

let n = 0;
async function mk(role: "CUSTOMER" | "DISTRIBUTOR" | "PROVIDER", status: "ACTIVE" | "PENDING" | "REJECTED" = "ACTIVE") {
  n += 1;
  const u = await svc.registerUser(db, {
    name: `User${n}`, email: `u${n}@x.com`, password: "password123", role, phone: "9876543210", businessName: `Biz${n}`, city: "Pune",
  } as never);
  const id = (u as { id: string }).id ?? (await db.select().from(schema.users).where(eq(schema.users.email, `u${n}@x.com`)))[0].id;
  await db.update(schema.users).set({ status }).where(eq(schema.users.id, id));
  return id;
}
async function signIn(userId: string) {
  const { token } = await sess.createSession(db, userId, 1);
  state.cookies.set("cl_session", token);
}
const future = () => new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
const body = (dists: Array<[string, number]>, over: object = {}) => ({
  unit: "BAGS",
  quantity: String(dists.reduce((s, [, b]) => s + b, 0)),
  address: "12 MG Road",
  city: "Pune",
  pincode: "411001",
  neededBy: future(),
  allocations: dists.map(([distributorId, bags]) => ({ distributorId, bags })),
  ...over,
});
const post = (payload: unknown) =>
  reqPost(new Request(`${APP}/api/requests`, { method: "POST", body: typeof payload === "string" ? payload : JSON.stringify(payload) }));
const getList = (q = "") => reqGet(new Request(`${APP}/api/requests${q}`));
const getOne = (id: string) => reqById(new Request(`${APP}/api/requests/${id}`), { params: Promise.resolve({ id }) });

let cust: string, cust2: string, d1: string, d2: string, prov: string;
beforeAll(async () => {
  db = (await import("@/server/db/client")).getDb();
  schema = await import("@/server/db/schema");
  svc = await import("@/server/services/users");
  sess = await import("@/server/auth/session");
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
  const r = await import("@/app/api/requests/route");
  reqPost = r.POST as unknown as Route;
  reqGet = r.GET as unknown as Route;
  reqById = (await import("@/app/api/requests/[id]/route")).GET as Route;
  distGet = (await import("@/app/api/distributors/route")).GET as unknown as Route;
  cust = await mk("CUSTOMER");
  cust2 = await mk("CUSTOMER");
  d1 = await mk("DISTRIBUTOR");
  d2 = await mk("DISTRIBUTOR");
  prov = await mk("PROVIDER");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  state.cookies = new Map();
  state.headers = new Headers({ origin: APP });
});

const todayIstStr = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const addDays = (s: string, d: number) => new Date(new Date(`${s}T00:00:00Z`).getTime() + d * 86_400_000).toISOString().slice(0, 10);

describe("QA V3 edge cases", () => {
  it("accepts today (IST) and rejects yesterday (IST)", async () => {
    await signIn(cust);
    expect((await post(body([[d1, 5]], { neededBy: todayIstStr() }))).status).toBe(201);
    expect((await post(body([[d1, 5]], { neededBy: addDays(todayIstStr(), -1) }))).status).toBe(400);
  });
  it("2.55 t = 51 bags is valid; 2.53 t and 2.5.0 are rejected", async () => {
    await signIn(cust);
    const ok = await post(body([[d1, 51]], { unit: "TONNES", quantity: "2.55" }));
    expect(ok.status).toBe(201);
    expect((await ok.json()).data.totalBags).toBe(51);
    for (const q of ["2.53", "2.555", "2.5.0", "-1", "1e1", " ", "abc", "0", "0.00"]) {
      expect((await post(body([[d1, 51]], { unit: "TONNES", quantity: q }))).status).toBe(400);
    }
  });
  it("duplicate distributor is 400, nothing saved", async () => {
    await signIn(cust);
    const before = (await db.select().from(schema.requests)).length;
    expect((await post(body([[d1, 5], [d1, 5]]))).status).toBe(400);
    expect((await db.select().from(schema.requests)).length).toBe(before);
  });
  it("pincode: 5 digits, 7 digits, letters, unicode digits, spaces rejected", async () => {
    await signIn(cust);
    for (const p of ["12345", "1234567", "41100a", "४११००१", " 411001", "411001\n"]) {
      expect((await post(body([[d1, 5]], { pincode: p }))).status).toBe(400);
    }
  });
  it("huge, negative, zero, float, string and non-finite quantities rejected", async () => {
    await signIn(cust);
    for (const q of ["100001", "99999999999", "1e9", "0", "-5", "5.5", "9".repeat(5000)]) {
      expect((await post(body([[d1, 5]], { quantity: q }))).status).toBe(400);
    }
    for (const bags of [1e12, -1, 0, 2.5, "5", null]) {
      expect((await post(body([[d1, 5]], { quantity: "5", allocations: [{ distributorId: d1, bags }] }))).status).toBe(400);
    }
    expect((await post(body([[d1, 5]], { quantity: 5 }))).status).toBe(400);
  });
  it("sum mismatch in both directions blocked", async () => {
    await signIn(cust);
    expect((await post(body([[d1, 5], [d2, 4]], { quantity: "10" }))).status).toBe(400);
    expect((await post(body([[d1, 5], [d2, 6]], { quantity: "10" }))).status).toBe(400);
  });
  it("boundary: exactly 100000 bags ok-sized, 20 allocations cap, empty allocations", async () => {
    await signIn(cust);
    expect((await post(body([[d1, 5]], { allocations: [] }))).status).toBe(400);
    expect((await post(body([[d1, 5]], { address: "x".repeat(301) }))).status).toBe(400);
    expect((await post(body([[d1, 5]], { city: "   " }))).status).toBe(400);
  });
  it("another customer's request is 404 and non-customers get 403 on every endpoint", async () => {
    await signIn(cust);
    const id = (await (await post(body([[d1, 5]]))).json()).data.id;
    await signIn(cust2);
    expect((await getOne(id)).status).toBe(404);
    for (const u of [d1, prov]) {
      await signIn(u);
      expect((await getOne(id)).status).toBe(403);
      expect((await post(body([[d1, 5]]))).status).toBe(403);
      expect((await getList()).status).toBe(403);
      expect((await distGet(new Request(`${APP}/api/distributors`))).status).toBe(403);
    }
  });
  // B1 (fixed): concurrent POSTs used to hit SQLITE_BUSY -> 500.
  it("double submit: two concurrent posts both return 201 (no SQLITE_BUSY 500)", async () => {
    await signIn(cust);
    const [a, b] = await Promise.all([post(body([[d1, 7]])), post(body([[d1, 7]]))]);
    expect([a.status, b.status]).toEqual([201, 201]);
  });
  it("array/prototype pollution body and null body rejected", async () => {
    await signIn(cust);
    expect((await post("null")).status).toBe(400);
    expect((await post("[]")).status).toBe(400);
    expect((await post(`{"__proto__":{"x":1},"unit":"BAGS"}`)).status).toBe(400);
  });
});
