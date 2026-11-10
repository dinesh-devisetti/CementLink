import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";

// Per-request state read by the mocked next/headers.
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
const dir = mkdtempSync(path.join(tmpdir(), "cl-routes-"));
process.env.DATABASE_URL = `file:${path.join(dir, "r.db")}`;
process.env.APP_URL = APP;
process.env.LOGIN_MAX_ATTEMPTS = "3";
process.env.REGISTER_MAX_PER_HOUR = "2";
process.env.TRUST_PROXY = "true";

// The Request carries the same x-real-ip the mocked next/headers exposes.
const json = (body: unknown) => {
  const ip = state.headers.get("x-real-ip");
  return new Request(`${APP}/x`, {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: ip ? { "x-real-ip": ip } : {},
  });
};
const asOrigin = (origin: string | null, extra: Record<string, string> = {}) => {
  const h = new Headers(extra);
  if (origin) h.set("origin", origin);
  state.headers = h;
};

const newUser = (email: string, over: Record<string, unknown> = {}) => ({
  name: "Ravi",
  email,
  password: "password123",
  role: "CUSTOMER",
  phone: "9876543210",
  ...over,
});

let register: typeof import("@/app/api/auth/register/route").POST;
let login: typeof import("@/app/api/auth/login/route").POST;
let logout: typeof import("@/app/api/auth/logout/route").POST;
let me: typeof import("@/app/api/me/route").GET;
let guards: typeof import("@/server/auth/guards");
let http: typeof import("@/server/auth/http");
let dbmod: typeof import("@/server/db/client");
let schema: typeof import("@/server/db/schema");

beforeAll(async () => {
  dbmod = await import("@/server/db/client");
  schema = await import("@/server/db/schema");
  await migrate(dbmod.getDb(), { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
  register = (await import("@/app/api/auth/register/route")).POST;
  login = (await import("@/app/api/auth/login/route")).POST;
  logout = (await import("@/app/api/auth/logout/route")).POST;
  me = (await import("@/app/api/me/route")).GET;
  guards = await import("@/server/auth/guards");
  http = await import("@/server/auth/http");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  state.cookies = new Map();
  asOrigin(APP, { "x-real-ip": "7.7.7.7" });
});

describe("origin check", () => {
  it.each([null, "http://evil.com", "garbage"])("rejects origin %j with 403 BAD_ORIGIN", async (o) => {
    asOrigin(o);
    for (const handler of [register, login, logout] as Array<(r?: Request) => Promise<Response>>) {
      const res = await handler(json(newUser("o@x.com")));
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("BAD_ORIGIN");
    }
  });
});

describe("input handling", () => {
  it("malformed JSON -> 400 BAD_JSON", async () => {
    const res = await register(json("{not json"));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("BAD_JSON");
  });
  it("invalid body -> 400 VALIDATION with field errors", async () => {
    const res = await register(json(newUser("bad", { password: "x" })));
    const body = await res.json();
    expect(res.status).toBe(400);
    expect(body.code).toBe("VALIDATION");
    expect(Object.keys(body.fields)).toEqual(expect.arrayContaining(["email", "password"]));
  });
  it("handleError maps unknown errors to a generic 500", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const res = http.handleError(new Error("secret db detail"));
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.code).toBe("INTERNAL");
    expect(JSON.stringify(body)).not.toContain("secret");
    spy.mockRestore();
  });
  it("clientIp only trusts x-real-ip when TRUST_PROXY is on and ignores x-forwarded-for", () => {
    const req = new Request(APP, { headers: { "x-forwarded-for": "1.1.1.1", "x-real-ip": "2.2.2.2" } });
    expect(http.clientIp(req, true)).toBe("2.2.2.2");
    expect(http.clientIp(req, false)).toBeNull();
    expect(http.clientIp(new Request(APP, { headers: { "x-forwarded-for": "1.1.1.1" } }), true)).toBeNull();
  });
});

describe("register + login + logout over the handlers", () => {
  it("register 201, duplicate 409, login sets hardened cookie, /api/me works, logout clears", async () => {
    asOrigin(APP, { "x-real-ip": "7.7.0.1" });
    expect((await register(json(newUser("flow@x.com")))).status).toBe(201);
    asOrigin(APP, { "x-real-ip": "7.7.0.2" });
    const dup = await register(json(newUser("FLOW@x.com")));
    expect(dup.status).toBe(409);

    const res = await login(json({ email: "flow@x.com", password: "password123" }));
    expect(res.status).toBe(200);
    expect((await res.json()).data.redirectTo).toBe("/customer");
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/cl_session=/);
    expect(setCookie).toMatch(/HttpOnly/i);
    expect(setCookie).toMatch(/SameSite=lax/i);
    expect(setCookie).toMatch(/Path=\//);
    const token = /cl_session=([^;]+)/.exec(setCookie)![1];

    state.cookies.set("cl_session", token);
    const who = await me();
    expect(who.status).toBe(200);
    expect((await who.json()).data.email).toBe("flow@x.com");

    const out = await logout();
    expect(out.status).toBe(200);
    expect(await me()).toHaveProperty("status", 401);
  });

  it("login removes the session of a cookie already held (no lingering old token)", async () => {
    await register(json(newUser("rot@x.com")));
    const first = await login(json({ email: "rot@x.com", password: "password123" }));
    const oldToken = /cl_session=([^;]+)/.exec(first.headers.get("set-cookie") ?? "")![1];
    state.cookies.set("cl_session", oldToken);
    await login(json({ email: "rot@x.com", password: "password123" }));
    expect(await me()).toHaveProperty("status", 401);
  });

  it("bad credentials 401 generic; 429 includes Retry-After", async () => {
    asOrigin(APP, { "x-real-ip": "7.7.1.1" });
    await register(json(newUser("lim@x.com")));
    for (let i = 0; i < 3; i++) {
      const r = await login(json({ email: "lim@x.com", password: "nope-nope" }));
      expect(r.status).toBe(401);
    }
    const r = await login(json({ email: "lim@x.com", password: "password123" }));
    expect(r.status).toBe(429);
    expect(Number(r.headers.get("retry-after"))).toBeGreaterThan(0);
    expect((await r.json()).code).toBe("RATE_LIMITED");
  });

  it("registration is rate limited per IP", async () => {
    asOrigin(APP, { "x-real-ip": "7.7.2.2" });
    const codes: number[] = [];
    for (let i = 0; i < 3; i++) codes.push((await register(json(newUser(`reg${i}@x.com`)))).status);
    expect(codes).toEqual([201, 201, 429]);
  });

  it("pending user logs in to /pending", async () => {
    asOrigin(APP, { "x-real-ip": "7.7.3.3" });
    await register(json(newUser("pend@x.com", { role: "DISTRIBUTOR", businessName: "B", city: "Pune" })));
    const res = await login(json({ email: "pend@x.com", password: "password123" }));
    expect((await res.json()).data.redirectTo).toBe("/pending");
  });
});

describe("guards", () => {
  async function loginAs(email: string, role: string, ip: string) {
    asOrigin(APP, { "x-real-ip": ip });
    await register(json(newUser(email, role === "CUSTOMER" ? {} : { role, businessName: "B", city: "C" })));
    if (role === "ADMIN") {
      const { seedAdmin } = await import("@/server/services/users");
      await seedAdmin(dbmod.getDb(), email, "password123");
    }
    const res = await login(json({ email, password: "password123" }));
    state.cookies.set("cl_session", /cl_session=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")![1]);
  }

  it("requireRole: 401 anonymous", async () => {
    const r = await guards.requireRole("ADMIN");
    expect("response" in r && r.response.status).toBe(401);
  });
  it("requireRole: 403 FORBIDDEN wrong role, ok for right role", async () => {
    await loginAs("g-cust@x.com", "CUSTOMER", "7.7.4.1");
    const bad = await guards.requireRole("ADMIN");
    expect("response" in bad && bad.response.status).toBe(403);
    expect("response" in bad && (await bad.response.json()).code).toBe("FORBIDDEN");
    const ok = await guards.requireRole("CUSTOMER");
    expect("actor" in ok && ok.actor.email).toBe("g-cust@x.com");
  });
  it("requireRole: 403 PENDING for unapproved users", async () => {
    await loginAs("g-pend@x.com", "PROVIDER", "7.7.4.2");
    const r = await guards.requireRole("PROVIDER");
    expect("response" in r && (await r.response.json()).code).toBe("PENDING");
  });
  it("requireRolePage redirects", async () => {
    await expect(guards.requireRolePage("ADMIN")).rejects.toThrow("REDIRECT:/login");
    await loginAs("g-page@x.com", "CUSTOMER", "7.7.4.3");
    await expect(guards.requireRolePage("ADMIN")).rejects.toThrow("REDIRECT:/customer");
    expect((await guards.requireRolePage("CUSTOMER")).email).toBe("g-page@x.com");
    await loginAs("g-pp@x.com", "DISTRIBUTOR", "7.7.4.4");
    await expect(guards.requireRolePage("DISTRIBUTOR")).rejects.toThrow("REDIRECT:/pending");
  });
  it("session of a deleted user stops working", async () => {
    await loginAs("g-del@x.com", "CUSTOMER", "7.7.4.5");
    await dbmod.getDb().delete(schema.users).where(eq(schema.users.email, "g-del@x.com"));
    expect(await guards.getActor()).toBeNull();
  });
});
