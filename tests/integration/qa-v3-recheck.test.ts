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
const dir = mkdtempSync(path.join(tmpdir(), "cl-qa3b-"));
process.env.DATABASE_URL = `file:${path.join(dir, "r.db")}`;
process.env.APP_URL = APP;
process.env.REQUEST_MAX_PER_HOUR = "6";

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

import { mapServerFields } from "@/lib/split";
const days = (d: number) => new Date(Date.now() + 330 * 60_000 + d * 86_400_000).toISOString().slice(0, 10);

describe("QA V3 re-check", () => {
  it("1. concurrent POSTs: no 500, all rows saved (x4, repeated)", async () => {
    const c = await mk("CUSTOMER");
    await signIn(c);
    const rs = await Promise.all([1, 2, 3, 4].map((i) => post(body([[d1, i + 1]]))));
    expect(rs.map((r) => r.status)).toEqual([201, 201, 201, 201]);
    const rows = await db.select().from(schema.requests).where(eq(schema.requests.customerId, c));
    expect(rows.length).toBe(4);
  });
  it("2. 429 after REQUEST_MAX_PER_HOUR with Retry-After; invalid posts count; other user unaffected", async () => {
    const c = await mk("CUSTOMER");
    await signIn(c);
    for (let i = 0; i < 6; i++) expect((await post(body([[d1, 5]]))).status).toBe(201);
    const r = await post(body([[d1, 5]]));
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await post("{bad")).status).toBe(429);
    await signIn(cust2);
    expect((await post(body([[d1, 5]]))).status).toBe(201);
  });
  it("3. 413 over 16KB, by content-length and by real size; 16KB-ish valid ok", async () => {
    const c = await mk("CUSTOMER");
    await signIn(c);
    const big = JSON.stringify(body([[d1, 5]], { address: "a".repeat(17_000) }));
    expect((await post(big)).status).toBe(413);
    const lie = new Request(`${APP}/api/requests`, { method: "POST", body: "{}", headers: { "content-length": "99999", origin: APP } });
    expect((await reqPost(lie)).status).toBe(413);
    const mid = JSON.stringify(body([[d1, 5]], { address: "a".repeat(301) }));
    expect((await post(mid)).status).toBe(400);
  });
  it("4. nested allocations.* server keys map to the allocations field; unknown -> general", () => {
    const m = mapServerFields({ "allocations.0.bags": "Must be at least 1 bag", "allocations.2.distributorId": "Invalid id", pincode: "x", weird: "boom" });
    expect(m.fields).toEqual({ allocations: "Must be at least 1 bag", pincode: "x" });
    expect(m.general).toBe("boom");
    expect(mapServerFields({ _: "Invalid input" }).general).toBe("Invalid input");
  });
  it("5. control and bidi characters rejected in address and city (schema; API counts every POST toward the rate limit)", async () => {
    const { createRequestSchema } = await import("@/lib/validation/requests");
    const bad = ["a\nb", "a\tb", "a\u0000b", "a\u202Eb", "a\u2066b", "a\u200Bb", "a\u200Fb", "a\u0085b", "a\u007Fb", "a\u009Fb"];
    for (const f of ["address", "city"]) {
      for (const s of bad) expect(createRequestSchema().safeParse(body([[d1, 1]], { [f]: s })).success).toBe(false);
    }
    expect(createRequestSchema().safeParse(body([[d1, 1]], { address: "Flat 4, Rd 12 \u2013 \u0928\u0908 \u0926\u093f\u0932\u094d\u0932\u0940" })).success).toBe(true);
    const c = await mk("CUSTOMER");
    await signIn(c);
    expect((await post(body([[d1, 1]], { address: "a\u202Eb" }))).status).toBe(400);
  });
  it("6. needed-by: +365 ok, +366 and far future rejected, today ok", async () => {
    const c = await mk("CUSTOMER");
    await signIn(c);
    expect((await post(body([[d1, 1]], { neededBy: days(365) }))).status).toBe(201);
    expect((await post(body([[d1, 1]], { neededBy: days(366) }))).status).toBe(400);
    expect((await post(body([[d1, 1]], { neededBy: "9999-12-31" }))).status).toBe(400);
  });
  it("7. race: distributor revoked after validation (service-level) still handled", async () => {
    const c = await mk("CUSTOMER");
    await db.update(schema.users).set({ status: "REJECTED" }).where(eq(schema.users.id, d2));
    await signIn(c);
    const r = await post(body([[d2, 5]]));
    expect(r.status).toBe(422);
    await db.update(schema.users).set({ status: "ACTIVE" }).where(eq(schema.users.id, d2));
  });
});
