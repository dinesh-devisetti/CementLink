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
const dir = mkdtempSync(path.join(tmpdir(), "cl-qav11-"));
process.env.DATABASE_URL = `file:${path.join(dir, "q.db")}`;
process.env.APP_URL = APP;
process.env.ACTION_MAX_PER_MIN = "40";

type Ctx = { params: Promise<{ id: string }> };
type Route = (req: Request, ctx?: Ctx) => Promise<Response>;
let db: ReturnType<typeof import("@/server/db/client").getDb>;
let schema: typeof import("@/server/db/schema");
let svc: typeof import("@/server/services/users");
let sess: typeof import("@/server/auth/session");
let R: Record<string, Route>;

type Role = "CUSTOMER" | "DISTRIBUTOR" | "PROVIDER";
let n = 0;
async function mk(role: Role, name: string, status: "ACTIVE" | "PENDING" | "REJECTED" = "ACTIVE") {
  n += 1;
  const u = await svc.registerUser(db, {
    name, email: `u${n}-${name.toLowerCase()}@x.com`, password: "password123", role, phone: "9876543210", businessName: `${name} Biz`, city: "Pune",
  } as never);
  await db.update(schema.users).set({ status }).where(eq(schema.users.id, u.id));
  return u;
}
async function signIn(userId: string) {
  const { token } = await sess.createSession(db, userId, 1);
  state.cookies.set("cl_session", token);
}
const url = (p: string) => `${APP}${p}`;
const post = (r: string, p: string, body?: unknown, id?: string) =>
  R[r](new Request(url(p), { method: "POST", body: body === undefined ? undefined : JSON.stringify(body) }), id ? { params: Promise.resolve({ id }) } : undefined);
const get = (r: string, p: string, id?: string) =>
  R[r](new Request(url(p)), id ? { params: Promise.resolve({ id }) } : undefined);
const as = async (u: { id: string }) => signIn(u.id);
const linkRow = async (upper: string, lower: string) =>
  (await db.select().from(schema.links).where(eq(schema.links.upperId, upper))).find((l) => l.lowerId === lower);

let admin: { id: string };
beforeAll(async () => {
  db = (await import("@/server/db/client")).getDb();
  schema = await import("@/server/db/schema");
  svc = await import("@/server/services/users");
  sess = await import("@/server/auth/session");
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
  R = {
    links: (await import("@/app/api/links/route")).POST as unknown as Route,
    linksGet: (await import("@/app/api/links/route")).GET as unknown as Route,
    approve: (await import("@/app/api/links/[id]/approve/route")).POST as unknown as Route,
    reject: (await import("@/app/api/links/[id]/reject/route")).POST as unknown as Route,
    revoke: (await import("@/app/api/links/[id]/revoke/route")).POST as unknown as Route,
    dirP: (await import("@/app/api/directory/providers/route")).GET as unknown as Route,
    dirD: (await import("@/app/api/directory/distributors/route")).GET as unknown as Route,
    provs: (await import("@/app/api/distributors/[id]/providers/route")).GET as unknown as Route,
    force: (await import("@/app/api/admin/links/route")).POST as unknown as Route,
  };
  await svc.seedAdmin(db, "admin@x.com", "AdminPass123!");
  [admin] = await db.select().from(schema.users).where(eq(schema.users.email, "admin@x.com"));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));
beforeEach(() => {
  state.cookies = new Map();
  state.headers = new Headers({ origin: APP });
});


const j = async (r: Response) => ({ s: r.status, b: (await r.json().catch(() => ({}))) as Record<string, unknown> });

describe("QA V11 edge cases", () => {
  it("double submit of the same request: one 201, the other 409; single row", async () => {
    const p = await mk("PROVIDER", "P1"); const d = await mk("DISTRIBUTOR", "D1");
    await as(d);
    const rs = await Promise.all([post("links", "/api/links", { targetId: p.id }), post("links", "/api/links", { targetId: p.id })]);
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409]);
    expect((await db.select().from(schema.links)).filter((l) => l.upperId === p.id).length).toBe(1);
  });

  it("wrong-role target, self, unknown id -> 404; unauthenticated -> 401; admin/provider POST /api/links -> 403", async () => {
    const p = await mk("PROVIDER", "P2"); const d = await mk("DISTRIBUTOR", "D2"); const c = await mk("CUSTOMER", "C2");
    await as(c);
    expect((await post("links", "/api/links", { targetId: p.id })).status).toBe(404);
    expect((await post("links", "/api/links", { targetId: c.id })).status).toBe(404);
    expect((await post("links", "/api/links", { targetId: "nope-123" })).status).toBe(404);
    state.cookies = new Map();
    expect((await post("links", "/api/links", { targetId: d.id })).status).toBe(401);
    expect((await get("linksGet", "/api/links")).status).toBe(401);
    await as(p);
    expect((await post("links", "/api/links", { targetId: d.id })).status).toBe(403);
    await as(admin);
    expect((await post("links", "/api/links", { targetId: d.id })).status).toBe(403);
    expect((await get("linksGet", "/api/links")).status).toBe(403);
  });

  it("request to a user who is not ACTIVE -> 404 and no row", async () => {
    const pend = await mk("PROVIDER", "PendP", "PENDING"); const rej = await mk("DISTRIBUTOR", "RejD", "REJECTED"); const d = await mk("DISTRIBUTOR", "D3"); const c = await mk("CUSTOMER", "C3");
    await as(d); expect((await post("links", "/api/links", { targetId: pend.id })).status).toBe(404);
    await as(c); expect((await post("links", "/api/links", { targetId: rej.id })).status).toBe(404);
    expect(await linkRow(pend.id, d.id)).toBeUndefined();
  });

  it("approve when requester was revoked meanwhile -> 409 and stays PENDING; third party approve/revoke -> 404", async () => {
    const p = await mk("PROVIDER", "P4"); const p2 = await mk("PROVIDER", "P4b"); const d = await mk("DISTRIBUTOR", "D4");
    await as(d); await post("links", "/api/links", { targetId: p.id });
    const l = (await linkRow(p.id, d.id))!;
    await as(p2);
    expect((await post("approve", "/api/links/x", undefined, l.id)).status).toBe(404);
    expect((await post("revoke", "/api/links/x", undefined, l.id)).status).toBe(404);
    await db.update(schema.users).set({ status: "REJECTED" }).where(eq(schema.users.id, d.id));
    await as(p);
    expect((await post("approve", "/api/links/x", undefined, l.id)).status).toBe(409);
    expect((await linkRow(p.id, d.id))!.status).toBe("PENDING");
  });

  it("customer cannot reach providers of a distributor with only a PENDING or REVOKED link (403 NOT_LINKED)", async () => {
    const d = await mk("DISTRIBUTOR", "D5"); const c = await mk("CUSTOMER", "C5");
    await as(c); await post("links", "/api/links", { targetId: d.id });
    expect((await j(await get("provs", "/x", d.id)))).toMatchObject({ s: 403, b: { error: "You are not linked to this distributor" } });
    await as(d); const l = (await linkRow(d.id, c.id))!;
    await post("approve", "/x", undefined, l.id);
    await as(c); expect((await get("provs", "/x", d.id)).status).toBe(200);
    await post("revoke", "/x", undefined, l.id);
    expect((await get("provs", "/x", d.id)).status).toBe(403);
  });

  it("directory validation: q > 60 chars, page 0, limit 0/1000 -> 400; no email/phone/name keys leak", async () => {
    const d = await mk("DISTRIBUTOR", "D6"); await mk("PROVIDER", "P6");
    await as(d);
    for (const qs of ["q=" + "a".repeat(61), "page=0", "limit=0", "limit=1000", "page=abc"]) {
      expect((await get("dirP", `/api/directory/providers?${qs}`)).status, qs).toBe(400);
    }
    const body = JSON.stringify(await (await get("dirP", "/api/directory/providers")).json());
    expect(body).not.toMatch(/@x\.com|9876543210|passwordHash|email|phone/i);
  });

  it("revoked/rejected user disappears from directory and provider list of customer", async () => {
    const p = await mk("PROVIDER", "P7"); const d = await mk("DISTRIBUTOR", "D7");
    await as(d);
    let dir = (await (await get("dirP", "/api/directory/providers")).json()).data;
    expect(dir.some((r: { id: string }) => r.id === p.id)).toBe(true);
    await db.update(schema.users).set({ status: "REJECTED" }).where(eq(schema.users.id, p.id));
    dir = (await (await get("dirP", "/api/directory/providers")).json()).data;
    expect(dir.some((r: { id: string }) => r.id === p.id)).toBe(false);
  });

  it("admin force-link rejects self, reversed roles, customer-provider, non-ACTIVE; link kinds correct", async () => {
    const p = await mk("PROVIDER", "P8"); const d = await mk("DISTRIBUTOR", "D8"); const c = await mk("CUSTOMER", "C8"); const pend = await mk("DISTRIBUTOR", "PD8", "PENDING");
    await as(admin);
    for (const b of [{ upperId: d.id, lowerId: p.id }, { upperId: p.id, lowerId: c.id }, { upperId: p.id, lowerId: pend.id }]) {
      expect((await post("force", "/api/admin/links", b)).status, JSON.stringify(b)).toBe(422);
    }
    expect((await post("force", "/api/admin/links", { upperId: p.id, lowerId: "ghost-1" })).status).toBe(404);
    expect((await post("force", "/api/admin/links", { upperId: p.id, lowerId: d.id })).status).toBe(201);
    expect((await linkRow(p.id, d.id))!.kind).toBe("PROVIDER_DISTRIBUTOR");
  });

  it("lower tier does not see upper's REVOKED row and re-requests after the cooldown; upper's rejected row hidden", async () => {
    const p = await mk("PROVIDER", "P9"); const d = await mk("DISTRIBUTOR", "D9");
    await as(admin); await post("force", "/api/admin/links", { upperId: p.id, lowerId: d.id });
    const l = (await linkRow(p.id, d.id))!;
    await as(p); await post("revoke", "/x", undefined, l.id);
    await as(d);
    const mine = (await (await get("linksGet", "/api/links")).json()).data.filter((r: { id: string }) => r.id === l.id);
    expect(mine).toHaveLength(0);
    // V12: an upper-tier revoke starts the same 24h cooldown as a rejection
    expect((await post("links", "/api/links", { targetId: p.id })).status).toBe(429);
    await db.update(schema.links).set({ updatedAt: Date.now() - 25 * 3600_000 }).where(eq(schema.links.id, l.id));
    expect((await post("links", "/api/links", { targetId: p.id })).status).toBe(201);
    expect((await linkRow(p.id, d.id))!.status).toBe("PENDING");
  });
});

describe("QA V11 re-QA 2: cancel + display name", () => {
  const cancel = async (id: string) => (await import("@/app/api/links/[id]/cancel/route")).POST(
    new Request(url("/api/links/x/cancel"), { method: "POST" }), { params: Promise.resolve({ id }) });
  const list = async () => (await (await get("linksGet", "/api/links")).json()).data as Array<{ id: string; status: string; counterpart: Record<string, unknown> }>;

  it("cancel matrix: requester ok; upper/stranger/unknown 404; non-pending 409; provider/admin/anon 403/401; no cooldown; rejected cannot be cancelled", async () => {
    const g = await mk("DISTRIBUTOR", "GC"); const g2 = await mk("DISTRIBUTOR", "GC2"); const r = await mk("CUSTOMER", "RC"); const r2 = await mk("CUSTOMER", "RC2"); const pv = await mk("PROVIDER", "PC");
    await as(r); await post("links", "/api/links", { targetId: g.id });
    const l = (await linkRow(g.id, r.id))!;
    await as(g); expect((await cancel(l.id)).status).toBe(404);
    await as(r2); expect((await cancel(l.id)).status).toBe(404);
    await as(r); expect((await cancel("ghost-1")).status).toBe(404);
    await as(pv); expect((await cancel(l.id)).status).toBe(403);
    await as(admin); expect((await cancel(l.id)).status).toBe(403);
    state.cookies = new Map(); expect((await cancel(l.id)).status).toBe(401);
    await as(r); state.headers = new Headers({ origin: "http://evil.example" }); expect((await cancel(l.id)).status).toBe(403);
    state.headers = new Headers({ origin: APP });
    expect((await cancel(l.id)).status).toBe(200);
    expect((await cancel(l.id)).status).toBe(409);
    await as(g); expect((await list()).some((x) => x.id === l.id)).toBe(false);
    await as(r); expect((await post("links", "/api/links", { targetId: g.id })).status).toBe(201);
    await as(g); await post("reject", "/x", undefined, l.id);
    await as(r); expect((await cancel(l.id)).status).toBe(409);
    const c = await post("links", "/api/links", { targetId: g.id });
    expect(c.status).toBe(429); expect(c.headers.get("Retry-After")).toBeTruthy();
    // active link cannot be cancelled by lower either
    await as(admin); await post("force", "/api/admin/links", { upperId: g2.id, lowerId: r.id });
    const l2 = (await linkRow(g2.id, r.id))!;
    await as(r); expect((await cancel(l2.id)).status).toBe(404); // force-linked: requested_by is admin, lower is not the requester
  });

  it("personal name only on own upper-party link rows; business-named rows unchanged; others and directories see placeholder", async () => {
    const g = await mk("DISTRIBUTOR", "GN"); const g2 = await mk("DISTRIBUTOR", "GN2"); const r = await mk("CUSTOMER", "SecretRamuName");
    await db.update(schema.users).set({ businessName: null, city: "Nashik" }).where(eq(schema.users.id, r.id));
    await as(r); await post("links", "/api/links", { targetId: g.id });
    await as(g);
    const mine = JSON.stringify(await list());
    expect(mine).toContain("SecretRamuName"); expect(mine).toContain("Nashik");
    expect(mine).not.toMatch(/@x\.com|9876543210/);
    await as(g2);
    expect(JSON.stringify(await list())).not.toContain("SecretRamuName");
    await as(r);
    const dir = JSON.stringify(await (await get("dirD", "/api/directory/distributors")).json());
    expect(dir).not.toMatch(/SecretRamuName/);
    // customer's own view of its link must not echo its own name as counterpart nor expose distributor personal name
    expect(JSON.stringify(await list())).not.toMatch(/"name"|SecretRamuName/);
    // customer never visible in providers listing or search by name
    const r2 = await mk("CUSTOMER", "Other"); await as(r2);
    expect((await (await get("dirD", "/api/directory/distributors?q=SecretRamuName")).json()).data).toHaveLength(0);
  });
});
