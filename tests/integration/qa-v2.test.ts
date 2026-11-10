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
const dir = mkdtempSync(path.join(tmpdir(), "cl-qav2-"));
process.env.DATABASE_URL = `file:${path.join(dir, "q.db")}`;
process.env.APP_URL = APP;

type Route = (req: Request, ctx?: { params: Promise<{ id: string }> }) => Promise<Response>;
let list: Route, approve: Route, reject: Route;
let db: ReturnType<typeof import("@/server/db/client").getDb>;
let schema: typeof import("@/server/db/schema");
let svc: typeof import("@/server/services/users");
let sess: typeof import("@/server/auth/session");
let guards: typeof import("@/server/auth/guards");

async function mk(email: string, role: "CUSTOMER" | "DISTRIBUTOR" | "PROVIDER") {
  return svc.registerUser(db, { name: "N", email, password: "password123", role, phone: "9876543210", businessName: "B", city: "Pune" } as never);
}
async function signIn(userId: string) {
  const { token } = await sess.createSession(db, userId, 1);
  state.cookies.set("cl_session", token);
}
const call = (r: Route, id?: string, method = "POST") =>
  r(new Request(`${APP}/api/admin/users${id ? `/${id}` : ""}`, { method }), id ? { params: Promise.resolve({ id }) } : undefined);

let adminId: string;
beforeAll(async () => {
  const dbmod = await import("@/server/db/client");
  db = dbmod.getDb();
  schema = await import("@/server/db/schema");
  svc = await import("@/server/services/users");
  sess = await import("@/server/auth/session");
  guards = await import("@/server/auth/guards");
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
  list = (await import("@/app/api/admin/users/route")).GET as unknown as Route;
  approve = (await import("@/app/api/admin/users/[id]/approve/route")).POST as Route;
  reject = (await import("@/app/api/admin/users/[id]/reject/route")).POST as Route;
  await svc.seedAdmin(db, "admin@x.com", "AdminPass123!");
  [{ id: adminId }] = await db.select().from(schema.users).where(eq(schema.users.email, "admin@x.com"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  state.cookies = new Map();
  state.headers = new Headers({ origin: APP });
});


describe("QA V2 edges", () => {
  it("rejected distributor: approve/list APIs 403 PENDING, own role API denied", async () => {
    const u = await mk("rej@x.com", "DISTRIBUTOR");
    await db.update(schema.users).set({ status: "REJECTED" }).where(eq(schema.users.id, u.id));
    await signIn(u.id);
    expect((await call(list, undefined, "GET")).status).toBe(403);
    const res = await call(approve, u.id);
    expect(res.status).toBe(403);
    const after = await db.select().from(schema.users).where(eq(schema.users.id, u.id));
    expect(after[0].status).toBe("REJECTED");
  });

  it("pending user cannot self-approve", async () => {
    const u = await mk("self@x.com", "PROVIDER");
    await signIn(u.id);
    expect((await call(approve, u.id)).status).toBe(403);
    const after = await db.select().from(schema.users).where(eq(schema.users.id, u.id));
    expect(after[0].status).toBe("PENDING");
  });

  it("approve customer via HTTP -> 409 INVALID_TARGET; customer status unchanged", async () => {
    const c = await mk("cust@x.com", "CUSTOMER");
    await signIn(adminId);
    const res = await call(approve, c.id);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("INVALID_TARGET");
    const rej = await call(reject, c.id);
    expect(rej.status).toBe(409);
  });

  it("double approve is idempotent; revoke ACTIVE kills old cookie (401)", async () => {
    const d = await mk("dbl@x.com", "DISTRIBUTOR");
    await signIn(adminId);
    expect((await call(approve, d.id)).status).toBe(200);
    expect((await call(approve, d.id)).status).toBe(200);
    const { token } = await sess.createSession(db, d.id, 1);
    expect(await guards.getActor()).not.toBeNull();
    state.cookies.set("cl_session", token);
    expect((await guards.getActor())?.id).toBe(d.id);
    state.cookies.set("cl_session", (await sess.createSession(db, adminId, 1)).token);
    expect((await call(reject, d.id)).status).toBe(200);
    state.cookies.set("cl_session", token);
    expect(await guards.getActor()).toBeNull();
  });

  it("list response never leaks password hashes; weird ids give 400 not 500", async () => {
    await mk("leak@x.com", "PROVIDER");
    await signIn(adminId);
    const body = JSON.stringify(await (await call(list, undefined, "GET")).json());
    expect(body).not.toMatch(/passwordHash|argon2/i);
    for (const id of ["' OR 1=1 --", "a".repeat(5000), "%00", "<script>"]) {
      expect((await call(approve, id)).status).toBe(400);
    }
  });

  it("admin list GET works without Origin; POST without Origin is 403", async () => {
    await signIn(adminId);
    state.headers = new Headers();
    expect((await call(list, undefined, "GET")).status).toBe(200);
    expect((await call(approve, "x")).status).toBe(403);
  });
});
