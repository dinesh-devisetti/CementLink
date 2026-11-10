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
const dir = mkdtempSync(path.join(tmpdir(), "cl-admin-"));
process.env.DATABASE_URL = `file:${path.join(dir, "a.db")}`;
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

describe("admin API access control over HTTP handlers", () => {
  it("anonymous -> 401 on list/approve/reject", async () => {
    for (const r of [list, approve, reject]) {
      const res = await call(r, "x", r === list ? "GET" : "POST");
      expect(res.status).toBe(401);
    }
  });

  it.each(["CUSTOMER", "DISTRIBUTOR", "PROVIDER"] as const)("%s -> 403 FORBIDDEN and target unchanged", async (role) => {
    const target = await mk(`t-${role}@x.com`, "DISTRIBUTOR");
    const actor = await mk(`a-${role}@x.com`, role);
    await db.update(schema.users).set({ status: "ACTIVE" }).where(eq(schema.users.id, actor.id));
    await signIn(actor.id);
    for (const r of [approve, reject]) {
      const res = await call(r, target.id);
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("FORBIDDEN");
    }
    const lres = await call(list, undefined, "GET");
    expect(lres.status).toBe(403);
    const [after] = await db.select().from(schema.users).where(eq(schema.users.id, target.id));
    expect(after.status).toBe("PENDING");
  });

  it("pending (unapproved) distributor -> 403 PENDING", async () => {
    const d = await mk("pd@x.com", "DISTRIBUTOR");
    await signIn(d.id);
    const res = await call(list, undefined, "GET");
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("PENDING");
  });

  it("foreign or missing Origin -> 403 BAD_ORIGIN before any auth or change", async () => {
    const t = await mk("bo@x.com", "PROVIDER");
    await signIn(adminId);
    for (const o of [null, "http://evil.com"]) {
      state.headers = new Headers(o ? { origin: o } : {});
      const res = await call(approve, t.id);
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("BAD_ORIGIN");
    }
    const [after] = await db.select().from(schema.users).where(eq(schema.users.id, t.id));
    expect(after.status).toBe("PENDING");
  });
});

describe("admin approve/reject over HTTP", () => {
  it("admin lists pending, approves, user sessions die, status ACTIVE", async () => {
    const t = await mk("flow@x.com", "DISTRIBUTOR");
    await sess.createSession(db, t.id, 1);
    await signIn(adminId);
    const l = await (await call(list, undefined, "GET")).json();
    expect(l.data.map((u: { id: string }) => u.id)).toContain(t.id);
    expect(JSON.stringify(l)).not.toMatch(/passwordHash|argon2/);

    const res = await call(approve, t.id);
    expect(res.status).toBe(200);
    expect((await res.json()).data.status).toBe("ACTIVE");
    expect(await db.select().from(schema.sessions).where(eq(schema.sessions.userId, t.id))).toHaveLength(1);
    expect(l.meta).toMatchObject({ page: 1, limit: 50 });
    expect(l.meta.total).toBeGreaterThan(0);
  });

  it("paging params validated: limit>50, page<1, non-numeric -> 400; limit=1 pages", async () => {
    await signIn(adminId);
    for (const q of ["limit=51", "limit=0", "page=0", "page=abc"]) {
      const res = await list(new Request(`${APP}/api/admin/users?${q}`), undefined as never);
      expect(res.status).toBe(400);
    }
    const ok = await list(new Request(`${APP}/api/admin/users?limit=1&page=1`), undefined as never);
    expect((await ok.json()).data).toHaveLength(1);
  });

  it("malformed :id -> 400 VALIDATION before any DB work", async () => {
    await signIn(adminId);
    for (const id of ["a b", "x".repeat(65), "../etc", "%00"]) {
      const res = await call(approve, id);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("VALIDATION");
    }
  });

  it("reject works; unknown id 404; ADMIN target 409; bad status filter 400", async () => {
    const t = await mk("rj@x.com", "PROVIDER");
    await signIn(adminId);
    expect((await (await call(reject, t.id)).json()).data.status).toBe("REJECTED");
    expect((await call(approve, "missing")).status).toBe(404);
    expect((await call(reject, adminId)).status).toBe(409);
    expect((await call(approve, adminId)).status).toBe(409);
    const bad = await list(new Request(`${APP}/api/admin/users?status=HACK`), undefined);
    expect(bad.status).toBe(400);
    const rejectedList = await list(new Request(`${APP}/api/admin/users?status=REJECTED`), undefined);
    expect((await rejectedList.json()).data.map((u: { id: string }) => u.id)).toContain(t.id);
  });
});

describe("withAuth error handling", () => {
  it("JSON 500 INTERNAL when the origin check or session lookup throws", async () => {
    const { withAuth } = await import("@/server/auth/with-auth");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const boom = vi.spyOn(guards, "requireRole").mockRejectedValueOnce(new Error("db down"));
    const h = withAuth(["ADMIN"], async () => new Response() as never);
    const res = await h(new Request(`${APP}/x`, { method: "POST" }), { params: Promise.resolve({}) });
    expect(res.status).toBe(500);
    expect((await res.json()).code).toBe("INTERNAL");
    boom.mockRestore();
    spy.mockRestore();
  });

  it("handler exceptions map to JSON 500 and GET skips the Origin check", async () => {
    const { withAuth } = await import("@/server/auth/with-auth");
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await signIn(adminId);
    state.headers = new Headers(); // no origin
    const ok = withAuth(["ADMIN"], async () => Response.json({ ok: true }) as never);
    expect((await ok(new Request(`${APP}/x`), { params: Promise.resolve({}) })).status).toBe(200);
    const bad = withAuth(["ADMIN"], async () => {
      throw new Error("x");
    });
    state.headers = new Headers({ origin: APP });
    expect((await bad(new Request(`${APP}/x`, { method: "POST" }), { params: Promise.resolve({}) })).status).toBe(500);
    spy.mockRestore();
  });
});

describe("page guards and access gate", () => {
  it("requireRolePage: pending/rejected -> /pending, wrong role -> own dashboard, anon -> /login", async () => {
    await expect(guards.requireRolePage("DISTRIBUTOR")).rejects.toThrow("REDIRECT:/login");
    const d = await mk("pg@x.com", "DISTRIBUTOR");
    await signIn(d.id);
    await expect(guards.requireRolePage("DISTRIBUTOR")).rejects.toThrow("REDIRECT:/pending");
    await db.update(schema.users).set({ status: "REJECTED" }).where(eq(schema.users.id, d.id));
    await expect(guards.requireRolePage("DISTRIBUTOR")).rejects.toThrow("REDIRECT:/pending");
    await db.update(schema.users).set({ status: "ACTIVE" }).where(eq(schema.users.id, d.id));
    await expect(guards.requireRolePage("ADMIN")).rejects.toThrow("REDIRECT:/distributor");
    await expect(guards.requireRolePage("DISTRIBUTOR")).resolves.toMatchObject({ id: d.id });
  });

  it("data isolation: /api/me returns only the caller", async () => {
    const a = await mk("iso-a@x.com", "CUSTOMER");
    const b = await mk("iso-b@x.com", "CUSTOMER");
    await signIn(a.id);
    const me = (await import("@/app/api/me/route")).GET;
    const body = await (await me()).json();
    expect(body.data.id).toBe(a.id);
    expect(JSON.stringify(body)).not.toContain(b.id);
  });
});
