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
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));

const APP = "http://localhost:3000";
const dir = mkdtempSync(path.join(tmpdir(), "cl-lim-"));
process.env.DATABASE_URL = `file:${path.join(dir, "l.db")}`;
process.env.APP_URL = APP;
process.env.REQUEST_MAX_PER_HOUR = "3";

type Route = (req: Request) => Promise<Response>;
let reqPost: Route;
let db: ReturnType<typeof import("@/server/db/client").getDb>;
let schema: typeof import("@/server/db/schema");
let sess: typeof import("@/server/auth/session");
let svc: typeof import("@/server/services/requests");
let c1: string, c2: string, c3: string, d1: string, d2: string;

async function mk(role: "CUSTOMER" | "DISTRIBUTOR", email: string, businessName: string | null) {
  const u = await (await import("@/server/services/users")).registerUser(db, {
    name: "N", email, password: "password123", role, phone: "9876543210", businessName: businessName ?? "tmp", city: "Pune",
  } as never);
  const id = (u as { id: string }).id;
  await db.update(schema.users).set({ status: "ACTIVE", ...(businessName === null ? { businessName: null } : {}) }).where(eq(schema.users.id, id));
  return id;
}
const signIn = async (id: string) => state.cookies.set("cl_session", (await sess.createSession(db, id, 1)).token);
const future = () => new Date(Date.now() + 5 * 86_400_000).toISOString().slice(0, 10);
const payload = (over: object = {}) => ({
  unit: "BAGS", quantity: "5", address: "12 MG Road", city: "Pune", pincode: "411001", neededBy: future(),
  allocations: [{ distributorId: d1, bags: 5 }], ...over,
});
const post = (p: unknown, headers: Record<string, string> = {}) =>
  reqPost(new Request(`${APP}/api/requests`, { method: "POST", body: typeof p === "string" ? p : JSON.stringify(p), headers }));

beforeAll(async () => {
  db = (await import("@/server/db/client")).getDb();
  schema = await import("@/server/db/schema");
  sess = await import("@/server/auth/session");
  svc = await import("@/server/services/requests");
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
  reqPost = (await import("@/app/api/requests/route")).POST as unknown as Route;
  c1 = await mk("CUSTOMER", "c1@x.com", null);
  c2 = await mk("CUSTOMER", "c2@x.com", null);
  c3 = await mk("CUSTOMER", "c3@x.com", null);
  d1 = await mk("DISTRIBUTOR", "d1@x.com", null);
  d2 = await mk("DISTRIBUTOR", "d2@x.com", "Gupta");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  state.cookies = new Map();
  state.headers = new Headers({ origin: APP });
});

describe("rate limit and body cap", () => {
  it("config default is 10", async () => {
    const { parseConfig } = await import("@/server/config");
    expect(parseConfig({ DATABASE_URL: "file:x" } as never).REQUEST_MAX_PER_HOUR).toBe(10);
  });
  it("body over ~16KB is 413 before parsing (content-length and actual size)", async () => {
    await signIn(c3);
    const big = JSON.stringify(payload({ address: "x".repeat(20_000) }));
    const a = await post(big);
    expect(a.status).toBe(413);
    expect((await a.json()).code).toBe("PAYLOAD_TOO_LARGE");
    const b = await post(big, { "content-length": "10" });
    expect(b.status).toBe(413);
    const c = await post("{}", { "content-length": "99999" });
    expect(c.status).toBe(413);
  });
  it("per-user limit: 429 with Retry-After after REQUEST_MAX_PER_HOUR, other users unaffected", async () => {
    await signIn(c1);
    for (let i = 0; i < 3; i++) expect((await post(payload())).status).toBe(201);
    const res = await post(payload());
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await res.json()).code).toBe("RATE_LIMITED");
    await signIn(c2);
    expect((await post(payload())).status).toBe(201);
  });
});

describe("service guards", () => {
  it("fallback name when distributor has no business name", async () => {
    const [v] = (await svc.listRequests(db, c2, { page: 1, limit: 5 })).rows;
    expect(v.lines[0].distributorName).toBe("Distributor");
  });
  it("service rejects duplicate distributors and sum mismatch itself", async () => {
    const base = { address: "a", city: "c", pincode: "411001", neededBy: future() };
    await expect(
      svc.createRequest(db, c2, { ...base, totalBags: 10, allocations: [{ distributorId: d2, bags: 5 }, { distributorId: d2, bags: 5 }] }),
    ).rejects.toMatchObject({ httpStatus: 400 });
    await expect(
      svc.createRequest(db, c2, { ...base, totalBags: 10, allocations: [{ distributorId: d2, bags: 4 }] }),
    ).rejects.toMatchObject({ httpStatus: 400 });
  });
});
