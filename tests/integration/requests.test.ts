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
const dir = mkdtempSync(path.join(tmpdir(), "cl-req-"));
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

let cust: string, cust2: string, d1: string, d2: string, dPending: string, dRejected: string, prov: string;
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
  dPending = await mk("DISTRIBUTOR", "PENDING");
  dRejected = await mk("DISTRIBUTOR", "REJECTED");
  prov = await mk("PROVIDER");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  state.cookies = new Map();
  state.headers = new Headers({ origin: APP });
});

describe("GET /api/distributors", () => {
  it("lists only ACTIVE distributors with no contact data", async () => {
    await signIn(cust);
    const res = await distGet(new Request(`${APP}/api/distributors`));
    expect(res.status).toBe(200);
    const { data } = await res.json();
    const ids = data.map((d: { id: string }) => d.id).sort();
    expect(ids).toEqual([d1, d2].sort());
    expect(ids).not.toContain(dPending);
    expect(ids).not.toContain(dRejected);
    expect(ids).not.toContain(prov);
    expect(Object.keys(data[0]).sort()).toEqual(["businessName", "city", "id"]);
  });
  it("is customer-only", async () => {
    expect((await distGet(new Request(`${APP}/api/distributors`))).status).toBe(401);
    await signIn(d1);
    expect((await distGet(new Request(`${APP}/api/distributors`))).status).toBe(403);
  });
});

describe("POST /api/requests", () => {
  it("creates a request with one SENT line per distributor", async () => {
    await signIn(cust);
    const res = await post(body([[d1, 30], [d2, 20]]));
    expect(res.status).toBe(201);
    const { data } = await res.json();
    expect(data.totalBags).toBe(50);
    expect(data.lines).toHaveLength(2);
    expect(data.lines.every((l: { status: string }) => l.status === "SENT")).toBe(true);
    const rows = await db.select().from(schema.requestLines).where(eq(schema.requestLines.requestId, data.id));
    expect(rows.map((r) => r.qtyBags).sort()).toEqual([20, 30]);
    const [req] = await db.select().from(schema.requests).where(eq(schema.requests.id, data.id));
    expect(req.customerId).toBe(cust);
  });
  it("stores tonnes as bags", async () => {
    await signIn(cust);
    const res = await post(body([[d1, 50]], { unit: "TONNES", quantity: "2.5" }));
    expect(res.status).toBe(201);
    expect((await res.json()).data.totalBags).toBe(50);
  });
  it("ignores a client-sent customerId / totalBags (strict schema)", async () => {
    await signIn(cust);
    const res = await post(body([[d1, 10]], { customerId: cust2, totalBags: 999 }));
    expect(res.status).toBe(400);
  });
  it("400 on sum mismatch, bad pincode, past date, fractional tonnes, bad JSON", async () => {
    await signIn(cust);
    expect((await post(body([[d1, 10]], { quantity: "11" }))).status).toBe(400);
    expect((await post(body([[d1, 10]], { pincode: "12345" }))).status).toBe(400);
    expect((await post(body([[d1, 10]], { neededBy: "2020-01-01" }))).status).toBe(400);
    expect((await post(body([[d1, 10]], { unit: "TONNES", quantity: "0.03" }))).status).toBe(400);
    const bad = await post("{nope");
    expect(bad.status).toBe(400);
    expect((await bad.json()).code).toBe("BAD_JSON");
  });
  it("422 for pending, rejected, provider or unknown distributors; nothing saved", async () => {
    await signIn(cust);
    const before = (await db.select().from(schema.requests)).length;
    for (const bad of [dPending, dRejected, prov, cust2, "does-not-exist"]) {
      const res = await post(body([[d1, 10], [bad, 10]]));
      expect(res.status).toBe(422);
      expect((await res.json()).code).toBe("INVALID_DISTRIBUTOR");
    }
    expect((await db.select().from(schema.requests)).length).toBe(before);
  });
  it("is atomic: a failing line insert rolls back the request", async () => {
    await signIn(cust);
    const before = (await db.select().from(schema.requests)).length;
    await db.$client.execute(
      "CREATE TRIGGER fail_line BEFORE INSERT ON request_lines WHEN NEW.qty_bags = 7 BEGIN SELECT RAISE(ABORT,'boom'); END",
    );
    try {
      const res = await post(body([[d1, 7]]));
      expect(res.status).toBe(500);
    } finally {
      await db.$client.execute("DROP TRIGGER fail_line");
    }
    expect((await db.select().from(schema.requests)).length).toBe(before);
  });
  it("auth: 401 anon, 403 other roles, 403 bad origin", async () => {
    expect((await post(body([[d1, 10]]))).status).toBe(401);
    for (const u of [d1, prov]) {
      await signIn(u);
      expect((await post(body([[d1, 10]]))).status).toBe(403);
    }
    await signIn(cust);
    state.headers = new Headers({ origin: "http://evil.example" });
    expect((await post(body([[d1, 10]]))).status).toBe(403);
  });
});

describe("customer isolation", () => {
  it("lists only own requests and 404s on another customer's request id", async () => {
    await signIn(cust2);
    const mine = await (await post(body([[d2, 15]]))).json();
    await signIn(cust);
    const theirs = await (await post(body([[d1, 5]]))).json();

    const list = await (await getList()).json();
    const ids = list.data.map((r: { id: string }) => r.id);
    expect(ids).toContain(theirs.data.id);
    expect(ids).not.toContain(mine.data.id);
    expect(list.meta.total).toBe(ids.length);

    const res = await getOne(mine.data.id);
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toContain("MG Road");
    expect((await getOne(theirs.data.id)).status).toBe(200);
  });
  it("detail shows distributor business name but no email/phone", async () => {
    await signIn(cust);
    const created = await (await post(body([[d1, 5]]))).json();
    const txt = JSON.stringify(await (await getOne(created.data.id)).json());
    expect(txt).toContain("Biz");
    expect(txt).not.toMatch(/@x\.com|9876543210|passwordHash/);
  });
  it("other roles cannot read requests; bad id is 400", async () => {
    await signIn(d1);
    expect((await getList()).status).toBe(403);
    expect((await getOne("x")).status).toBe(403);
    await signIn(cust);
    expect((await getOne("bad id!")).status).toBe(400);
    expect((await getOne("nonexistent")).status).toBe(404);
  });
  it("paginates with meta", async () => {
    await signIn(cust);
    const res = await getList("?page=1&limit=1");
    const j = await res.json();
    expect(j.data).toHaveLength(1);
    expect(j.meta.limit).toBe(1);
    expect((await getList("?limit=500")).status).toBe(400);
  });
});
