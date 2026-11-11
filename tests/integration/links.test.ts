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
const dir = mkdtempSync(path.join(tmpdir(), "cl-links-"));
process.env.DATABASE_URL = `file:${path.join(dir, "l.db")}`;
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

describe("request -> approve flow (S2)", () => {
  it("Giri requests Anjani: pending; Anjani approves: active in both lists", async () => {
    const giri = await mk("DISTRIBUTOR", "Giri");
    const anjani = await mk("PROVIDER", "Anjani");
    await as(giri);
    expect((await post("links", "/api/links", { targetId: anjani.id })).status).toBe(201);
    expect((await linkRow(anjani.id, giri.id))?.status).toBe("PENDING");
    const mine = (await (await get("linksGet", "/api/links")).json()).data;
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ status: "PENDING", direction: "outgoing", side: "lower", kind: "PROVIDER_DISTRIBUTOR" });

    await as(anjani);
    const inbox = (await (await get("linksGet", "/api/links")).json()).data;
    expect(inbox[0]).toMatchObject({ status: "PENDING", direction: "incoming", side: "upper" });
    expect(inbox[0].counterpart).toEqual({ id: giri.id, businessName: "Giri Biz", city: "Pune" });
    expect((await post("approve", `/api/links/${inbox[0].id}/approve`, undefined, inbox[0].id)).status).toBe(200);
    expect((await linkRow(anjani.id, giri.id))?.status).toBe("ACTIVE");
    expect((await (await get("linksGet", "/api/links")).json()).data[0].status).toBe("ACTIVE");
    await as(giri);
    expect((await (await get("linksGet", "/api/links")).json()).data[0].status).toBe("ACTIVE");
  });

  it("Ramu requests Giri: pending until Giri approves", async () => {
    const ramu = await mk("CUSTOMER", "Ramu");
    const giri = await mk("DISTRIBUTOR", "Giri2");
    await as(ramu);
    expect((await post("links", "/api/links", { targetId: giri.id })).status).toBe(201);
    const l = (await linkRow(giri.id, ramu.id))!;
    expect(l.kind).toBe("DISTRIBUTOR_CUSTOMER");
    expect(l.status).toBe("PENDING");
    await as(giri);
    expect((await post("approve", `/api/links/${l.id}/approve`, undefined, l.id)).status).toBe(200);
    expect((await linkRow(giri.id, ramu.id))?.status).toBe("ACTIVE");
  });

  it("duplicate request while pending or active -> 409; reject then re-request -> pending again", async () => {
    const ramu = await mk("CUSTOMER", "Ramu3");
    const giri = await mk("DISTRIBUTOR", "Giri3");
    await as(ramu);
    await post("links", "/api/links", { targetId: giri.id });
    const dup = await post("links", "/api/links", { targetId: giri.id });
    expect(dup.status).toBe(409);
    expect((await dup.json()).code).toBe("LINK_PENDING");
    const l = (await linkRow(giri.id, ramu.id))!;
    await as(giri);
    await post("reject", `/api/links/${l.id}/reject`, undefined, l.id);
    expect((await linkRow(giri.id, ramu.id))?.status).toBe("REJECTED");
    await as(ramu);
    // 24h cooldown after a rejection
    const cool = await post("links", "/api/links", { targetId: giri.id });
    expect(cool.status).toBe(429);
    expect((await cool.json()).code).toBe("REQUEST_COOLDOWN");
    expect(Number(cool.headers.get("Retry-After"))).toBeGreaterThan(23 * 3600);
    expect((await linkRow(giri.id, ramu.id))?.status).toBe("REJECTED");
    await db.update(schema.links).set({ decidedAt: Date.now() - 25 * 3600_000 }).where(eq(schema.links.id, l.id));
    expect((await post("links", "/api/links", { targetId: giri.id })).status).toBe(201);
    const again = (await linkRow(giri.id, ramu.id))!;
    expect(again).toMatchObject({ id: l.id, status: "PENDING", decidedAt: null });
    await as(giri);
    await post("approve", `/api/links/${l.id}/approve`, undefined, l.id);
    await as(ramu);
    const act = await post("links", "/api/links", { targetId: giri.id });
    expect(act.status).toBe(409);
    expect((await act.json()).code).toBe("ALREADY_LINKED");
  });

  it("revoke by either side, then re-request goes pending; revoked_by recorded", async () => {
    const ramu = await mk("CUSTOMER", "Ramu4");
    const giri = await mk("DISTRIBUTOR", "Giri4");
    await as(admin);
    await post("force", "/api/admin/links", { upperId: giri.id, lowerId: ramu.id });
    const l = (await linkRow(giri.id, ramu.id))!;
    await as(ramu);
    expect((await post("revoke", `/api/links/${l.id}/revoke`, undefined, l.id)).status).toBe(200);
    expect(await linkRow(giri.id, ramu.id)).toMatchObject({ status: "REVOKED", revokedBy: ramu.id });
    // second revoke: not ACTIVE -> 409
    expect((await post("revoke", `/api/links/${l.id}/revoke`, undefined, l.id)).status).toBe(409);
    // lower tier no longer sees the revoked link; upper still does
    expect((await (await get("linksGet", "/api/links")).json()).data).toHaveLength(0);
    await as(giri);
    expect((await (await get("linksGet", "/api/links")).json()).data[0].status).toBe("REVOKED");
    await as(ramu);
    expect((await post("links", "/api/links", { targetId: giri.id })).status).toBe(201);
    expect(await linkRow(giri.id, ramu.id)).toMatchObject({ status: "PENDING", revokedBy: null });
    // distributor side revoke of an active link
    await as(giri);
    await post("approve", `/api/links/${l.id}/approve`, undefined, l.id);
    expect((await post("revoke", `/api/links/${l.id}/revoke`, undefined, l.id)).status).toBe(200);
    expect(await linkRow(giri.id, ramu.id)).toMatchObject({ status: "REVOKED", revokedBy: giri.id });
  });
});

describe("authorisation and isolation", () => {
  it("only the addressed upper tier can approve/reject; strangers get 404; lower tier cannot approve its own request", async () => {
    const ramu = await mk("CUSTOMER", "Ramu5");
    const giri = await mk("DISTRIBUTOR", "Giri5");
    const other = await mk("DISTRIBUTOR", "Other5");
    await as(ramu);
    await post("links", "/api/links", { targetId: giri.id });
    const l = (await linkRow(giri.id, ramu.id))!;
    expect((await post("approve", `/api/links/${l.id}/approve`, undefined, l.id)).status).toBe(403); // CUSTOMER role
    await as(other);
    for (const a of ["approve", "reject", "revoke"]) {
      const res = await post(a, `/api/links/${l.id}/${a}`, undefined, l.id);
      expect(res.status).toBe(404);
    }
    expect((await linkRow(giri.id, ramu.id))?.status).toBe("PENDING");
    await as(giri);
    expect((await post("revoke", `/api/links/${l.id}/revoke`, undefined, l.id)).status).toBe(409); // pending, not active
    expect((await post("approve", "/api/links/nope-id/approve", undefined, "nope-id")).status).toBe(404);
  });

  it("pending and rejected links are not listed to third parties", async () => {
    const ramu = await mk("CUSTOMER", "Ramu6");
    const sita = await mk("CUSTOMER", "Sita6");
    const giri = await mk("DISTRIBUTOR", "Giri6");
    const other = await mk("DISTRIBUTOR", "Other6");
    await as(ramu);
    await post("links", "/api/links", { targetId: giri.id });
    await as(sita);
    await post("links", "/api/links", { targetId: giri.id });
    const sitaLink = (await linkRow(giri.id, sita.id))!;
    await as(giri);
    await post("reject", `/api/links/${sitaLink.id}/reject`, undefined, sitaLink.id);
    // Giri no longer sees the rejected request, still sees Ramu's pending one
    const gl = (await (await get("linksGet", "/api/links")).json()).data;
    expect(gl.map((l: { counterpart: { businessName: string } }) => l.counterpart.businessName)).toEqual(["Ramu6"]);
    // Sita sees her own rejected request, never Ramu's pending one
    await as(sita);
    const sl = (await (await get("linksGet", "/api/links")).json()).data;
    expect(sl.map((l: { status: string; counterpart: { businessName: string } }) => [l.counterpart.businessName, l.status])).toEqual([["Giri6 Biz", "REJECTED"]]);
    // an unrelated distributor sees nothing; admin-less third parties cannot read link rows
    await as(other);
    expect((await (await get("linksGet", "/api/links")).json()).data).toHaveLength(0);
    const dist = (await (await get("dirP", "/api/directory/providers")).json()).data;
    expect(dist.every((d: { linkStatus: unknown }) => d.linkStatus === null)).toBe(true);
  });

  it("another customer's outgoing pending request is not shown to a different lower-tier user of the same distributor", async () => {
    const a = await mk("CUSTOMER", "CustA");
    const b = await mk("CUSTOMER", "CustB");
    const g = await mk("DISTRIBUTOR", "GiriAB");
    await as(a);
    await post("links", "/api/links", { targetId: g.id });
    await as(b);
    expect((await (await get("linksGet", "/api/links")).json()).data).toHaveLength(0);
    const dir = (await (await get("dirD", "/api/directory/distributors")).json()).data;
    const row = dir.find((d: { id: string }) => d.id === g.id);
    expect(row.linkStatus).toBeNull();
  });

  it("unapproved (pending/rejected) providers and distributors are hidden from directories", async () => {
    const giri = await mk("DISTRIBUTOR", "GiriD");
    const ramu = await mk("CUSTOMER", "RamuD");
    const okP = await mk("PROVIDER", "VisibleProv");
    const pendP = await mk("PROVIDER", "PendingProv", "PENDING");
    const rejP = await mk("PROVIDER", "RejectedProv", "REJECTED");
    const pendD = await mk("DISTRIBUTOR", "PendingDist", "PENDING");
    await as(giri);
    const prov = (await (await get("dirP", "/api/directory/providers?limit=50")).json()).data;
    const ids = prov.map((p: { id: string }) => p.id);
    expect(ids).toContain(okP.id);
    expect(ids).not.toContain(pendP.id);
    expect(ids).not.toContain(rejP.id);
    await as(ramu);
    const dist = (await (await get("dirD", "/api/directory/distributors?limit=50")).json()).data;
    expect(dist.map((d: { id: string }) => d.id)).toContain(giri.id);
    expect(dist.map((d: { id: string }) => d.id)).not.toContain(pendD.id);
    // requesting a link to an unapproved party is a 404 and creates nothing
    await as(giri);
    expect((await post("links", "/api/links", { targetId: pendP.id })).status).toBe(404);
    await as(ramu);
    expect((await post("links", "/api/links", { targetId: pendD.id })).status).toBe(404);
    expect(await linkRow(pendP.id, giri.id)).toBeUndefined();
  });

  it("directory rows expose only id, business name, city and own link state; search filters and escapes wildcards", async () => {
    const giri = await mk("DISTRIBUTOR", "GiriS");
    const p = await mk("PROVIDER", "SearchTarget");
    await as(giri);
    const res = await get("dirP", "/api/directory/providers?q=searchtarget");
    const body = await res.json();
    expect(body.data).toHaveLength(1);
    expect(Object.keys(body.data[0]).sort()).toEqual(["businessName", "city", "id", "linkId", "linkStatus"]);
    expect(JSON.stringify(body)).not.toMatch(/@x\.com|9876543210|passwordHash/);
    expect(body.data[0].id).toBe(p.id);
    expect((await (await get("dirP", "/api/directory/providers?q=%25")).json()).data).toHaveLength(0);
    expect((await get("dirP", `/api/directory/providers?q=${"x".repeat(61)}`)).status).toBe(400);
    expect((await get("dirP", "/api/directory/providers?limit=51")).status).toBe(400);
  });

  it("role gates: directories and requests are for the right tier only", async () => {
    const prov = await mk("PROVIDER", "GateProv");
    const cust = await mk("CUSTOMER", "GateCust");
    const dist = await mk("DISTRIBUTOR", "GateDist");
    await as(prov);
    expect((await get("dirP", "/api/directory/providers")).status).toBe(403);
    expect((await post("links", "/api/links", { targetId: dist.id })).status).toBe(403);
    await as(cust);
    expect((await get("dirP", "/api/directory/providers")).status).toBe(403);
    await as(dist);
    expect((await get("dirD", "/api/directory/distributors")).status).toBe(403);
    expect((await post("force", "/api/admin/links", { upperId: prov.id, lowerId: dist.id })).status).toBe(403);
    state.cookies = new Map();
    expect((await get("linksGet", "/api/links")).status).toBe(401);
  });

  it("a customer sees a distributor's providers only through its own ACTIVE link", async () => {
    const ramu = await mk("CUSTOMER", "RamuP");
    const giri = await mk("DISTRIBUTOR", "GiriP");
    const anjani = await mk("PROVIDER", "AnjaniP");
    const ambuja = await mk("PROVIDER", "AmbujaP");
    const revoked = await mk("PROVIDER", "RevokedP");
    const pending = await mk("PROVIDER", "PendingLinkP");
    await as(admin);
    await post("force", "/api/admin/links", { upperId: anjani.id, lowerId: giri.id });
    await post("force", "/api/admin/links", { upperId: ambuja.id, lowerId: giri.id });
    await post("force", "/api/admin/links", { upperId: revoked.id, lowerId: giri.id });
    const rv = (await linkRow(revoked.id, giri.id))!;
    await as(giri);
    await post("revoke", `/api/links/${rv.id}/revoke`, undefined, rv.id);
    await post("links", "/api/links", { targetId: pending.id });
    await as(ramu);
    const res = await get("provs", `/api/distributors/${giri.id}/providers`, giri.id);
    expect(res.status).toBe(403); // not linked yet
    expect((await res.json()).code).toBe("NOT_LINKED");
    await as(admin);
    await post("force", "/api/admin/links", { upperId: giri.id, lowerId: ramu.id });
    await as(ramu);
    const ok = await (await get("provs", `/api/distributors/${giri.id}/providers`, giri.id)).json();
    expect(ok.data.map((p: { businessName: string }) => p.businessName).sort()).toEqual(["AmbujaP Biz", "AnjaniP Biz"]);
    expect(JSON.stringify(ok)).not.toMatch(/@x\.com|9876543210/);
    expect((await get("provs", "/api/distributors/bad%20id/providers", "bad id")).status).toBe(400);
  });
});

describe("transport rules: Origin, size, rate limit, validation", () => {
  it("foreign or missing Origin -> 403 BAD_ORIGIN and nothing changes", async () => {
    const giri = await mk("DISTRIBUTOR", "GiriO");
    const prov = await mk("PROVIDER", "ProvO");
    await as(giri);
    for (const o of [null, "http://evil.com"]) {
      state.headers = new Headers(o ? { origin: o } : {});
      const res = await post("links", "/api/links", { targetId: prov.id });
      expect(res.status).toBe(403);
      expect((await res.json()).code).toBe("BAD_ORIGIN");
    }
    expect(await linkRow(prov.id, giri.id)).toBeUndefined();
  });

  it("bodies over 16KB -> 413 on every mutation", async () => {
    const giri = await mk("DISTRIBUTOR", "GiriB");
    await as(giri);
    const big = { targetId: "x", pad: "y".repeat(17 * 1024) };
    expect((await post("links", "/api/links", big)).status).toBe(413);
    expect((await post("approve", "/api/links/abc/approve", big, "abc")).status).toBe(413);
    expect((await post("revoke", "/api/links/abc/revoke", big, "abc")).status).toBe(413);
    await as(admin);
    expect((await post("force", "/api/admin/links", big)).status).toBe(413);
  });

  it("invalid bodies -> 400 VALIDATION (unknown keys, bad ids, non-JSON)", async () => {
    const giri = await mk("DISTRIBUTOR", "GiriV");
    await as(giri);
    for (const body of [{}, { targetId: "a b" }, { targetId: "x".repeat(65) }, { targetId: "abc", extra: 1 }, { targetId: 5 }]) {
      const res = await post("links", "/api/links", body);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("VALIDATION");
    }
    const bad = await R.links(new Request(url("/api/links"), { method: "POST", body: "{nope" }));
    expect(bad.status).toBe(400);
    expect((await get("linksGet", "/api/links?kind=NOPE")).status).toBe(400);
    expect((await get("linksGet", "/api/links?page=0")).status).toBe(400);
  });

  it("act:link rate limit -> 429 with Retry-After after ACTION_MAX_PER_MIN, and nothing is written past it", async () => {
    const giri = await mk("DISTRIBUTOR", "GiriRL");
    const provs = [];
    for (let i = 0; i < 3; i++) provs.push(await mk("PROVIDER", `RL${i}`));
    await as(giri);
    const missing = "00000000-0000-0000-0000-000000000000";
    let last: Response | undefined;
    for (let i = 0; i < 40; i++) last = await post("links", "/api/links", { targetId: missing });
    expect(last?.status).toBe(404);
    const limited = await post("links", "/api/links", { targetId: provs[0].id });
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBeTruthy();
    expect(await linkRow(provs[0].id, giri.id)).toBeUndefined();
  });
});

describe("admin force-link", () => {
  it("creates ACTIVE, is idempotent, relinks a revoked pair, and validates pair/status", async () => {
    const giri = await mk("DISTRIBUTOR", "GiriF");
    const anjani = await mk("PROVIDER", "AnjaniF");
    const ramu = await mk("CUSTOMER", "RamuF");
    const pend = await mk("PROVIDER", "PendF", "PENDING");
    await as(admin);
    const a = await post("force", "/api/admin/links", { upperId: anjani.id, lowerId: giri.id });
    expect(a.status).toBe(201);
    expect(await linkRow(anjani.id, giri.id)).toMatchObject({ status: "ACTIVE", kind: "PROVIDER_DISTRIBUTOR", requestedBy: admin.id });
    expect((await post("force", "/api/admin/links", { upperId: anjani.id, lowerId: giri.id })).status).toBe(201);
    const l = (await linkRow(anjani.id, giri.id))!;
    await as(giri);
    await post("revoke", `/api/links/${l.id}/revoke`, undefined, l.id);
    await as(admin);
    expect((await post("force", "/api/admin/links", { upperId: anjani.id, lowerId: giri.id })).status).toBe(201);
    expect(await linkRow(anjani.id, giri.id)).toMatchObject({ id: l.id, status: "ACTIVE", revokedBy: null });
    // wrong pair, reversed, same user, pending user, missing user
    for (const [u, lo, code, status] of [
      [anjani.id, ramu.id, "INVALID_PAIR", 422],
      [giri.id, anjani.id, "INVALID_PAIR", 422],
      [giri.id, giri.id, "INVALID_PAIR", 422],
      [pend.id, giri.id, "INVALID_PAIR", 422],
      [anjani.id, "missing-user", "NOT_FOUND", 404],
    ] as const) {
      const res = await post("force", "/api/admin/links", { upperId: u, lowerId: lo });
      expect([res.status, (await res.json()).code]).toEqual([status, code]);
    }
  });
});

describe("fix loop 1", () => {
  let links: typeof import("@/server/services/links");
  let adminSvc: typeof import("@/server/services/admin-users");
  let dirSvc: typeof import("@/server/services/directory");
  beforeAll(async () => {
    links = await import("@/server/services/links");
    adminSvc = await import("@/server/services/admin-users");
    dirSvc = await import("@/server/services/directory");
  });
  const full = (id: string) => db.select().from(schema.users).where(eq(schema.users.id, id)).then((r) => r[0]);
  const settle = (ps: Promise<unknown>[]) => Promise.allSettled(ps);
  const code = (r: PromiseSettledResult<unknown>) => (r.status === "rejected" ? (r.reason as { code?: string }).code : "ok");

  it("forceLink on an ACTIVE row fails INVALID_PAIR once a party is no longer ACTIVE", async () => {
    const g = await mk("DISTRIBUTOR", "GiriX1");
    const p = await mk("PROVIDER", "ProvX1");
    await links.forceLink(db, await full(admin.id), p.id, g.id);
    await db.update(schema.users).set({ status: "REJECTED" }).where(eq(schema.users.id, p.id));
    await expect(links.forceLink(db, await full(admin.id), p.id, g.id)).rejects.toMatchObject({ code: "INVALID_PAIR", httpStatus: 422 });
    await db.update(schema.users).set({ status: "ACTIVE" }).where(eq(schema.users.id, p.id));
    await db.update(schema.users).set({ status: "PENDING" }).where(eq(schema.users.id, g.id));
    await expect(links.forceLink(db, await full(admin.id), p.id, g.id)).rejects.toMatchObject({ code: "INVALID_PAIR" });
    await db.update(schema.users).set({ status: "ACTIVE" }).where(eq(schema.users.id, g.id));
    await expect(links.forceLink(db, await full(admin.id), p.id, g.id)).resolves.toBeTruthy();
  });

  it("listLinkableParties caps each role separately", async () => {
    for (let i = 0; i < 5; i++) await mk("CUSTOMER", `Cap${i}`);
    await mk("PROVIDER", "CapProv");
    await mk("DISTRIBUTOR", "CapDist");
    const parties = await adminSvc.listLinkableParties(db, 3);
    const by = (r: string) => parties.filter((x) => x.role === r).length;
    expect(by("CUSTOMER")).toBe(3);
    expect(by("PROVIDER")).toBe(3);
    expect(by("DISTRIBUTOR")).toBe(3);
    expect(JSON.stringify(parties)).not.toMatch(/@x\.com|9876543210/);
  });

  it("listLinks pages with a total and keeps incoming PENDING requests on page 1", async () => {
    const prov = await mk("PROVIDER", "PagedProv");
    const dists = [];
    for (let i = 0; i < 4; i++) dists.push(await mk("DISTRIBUTOR", `PagedD${i}`));
    for (let i = 0; i < 3; i++) {
      await as(admin);
      await post("force", "/api/admin/links", { upperId: prov.id, lowerId: dists[i].id });
    }
    await as(dists[3]);
    await post("links", "/api/links", { targetId: prov.id }); // newest is the only PENDING one... but older actives must not push it off
    const me = await full(prov.id);
    const p1 = await links.listLinks(db, me, { page: 1, limit: 2 });
    expect(p1.total).toBe(4);
    expect(p1.rows[0]).toMatchObject({ status: "PENDING", direction: "incoming" });
    const p2 = await links.listLinks(db, me, { page: 2, limit: 2 });
    expect(p2.rows).toHaveLength(2);
    expect(new Set([...p1.rows, ...p2.rows].map((r) => r.id)).size).toBe(4);
    await as(prov);
    const res = await (await get("linksGet", "/api/links?limit=2")).json();
    expect(res.meta).toMatchObject({ total: 4, page: 1, limit: 2 });
  });

  it("directory meta carries a total", async () => {
    const g = await mk("DISTRIBUTOR", "GiriTot");
    await as(g);
    const res = await (await get("dirP", "/api/directory/providers?limit=1")).json();
    expect(res.meta.total).toBeGreaterThan(1);
    expect(res.data).toHaveLength(1);
  });

  it("approve vs reject on one PENDING link: exactly one wins and the state matches", async () => {
    const g = await mk("DISTRIBUTOR", "GiriC1");
    const r = await mk("CUSTOMER", "RamuC1");
    await as(r);
    await post("links", "/api/links", { targetId: g.id });
    const l = (await linkRow(g.id, r.id))!;
    const gu = await full(g.id);
    const res = await settle([links.decideLink(db, gu, l.id, "approve"), links.decideLink(db, gu, l.id, "reject")]);
    expect(res.filter((x) => x.status === "fulfilled")).toHaveLength(1);
    expect(res.map(code).sort()).toEqual(["INVALID_STATE", "ok"]);
    const winner = res[0].status === "fulfilled" ? "ACTIVE" : "REJECTED";
    expect((await linkRow(g.id, r.id))?.status).toBe(winner);
  });

  it("two identical requests: one succeeds, one 409", async () => {
    const g = await mk("DISTRIBUTOR", "GiriC2");
    const r = await mk("CUSTOMER", "RamuC2");
    const ru = await full(r.id);
    const res = await settle([links.requestLink(db, ru, g.id), links.requestLink(db, ru, g.id)]);
    expect(res.map(code).sort()).toEqual(["LINK_PENDING", "ok"]);
    expect((await db.select().from(schema.links).where(eq(schema.links.upperId, g.id))).filter((x) => x.lowerId === r.id)).toHaveLength(1);
  });

  it("revoke vs re-request on an ACTIVE link ends in a consistent state", async () => {
    const g = await mk("DISTRIBUTOR", "GiriC3");
    const r = await mk("CUSTOMER", "RamuC3");
    await links.forceLink(db, await full(admin.id), g.id, r.id);
    const l = (await linkRow(g.id, r.id))!;
    const ru = await full(r.id);
    const res = await settle([links.revokeLink(db, ru, l.id), links.requestLink(db, ru, g.id)]);
    expect(code(res[0])).toBe("ok");
    const final = (await linkRow(g.id, r.id))!;
    if (code(res[1]) === "ok") expect(final.status).toBe("PENDING");
    else {
      expect(code(res[1])).toBe("ALREADY_LINKED");
      expect(final.status).toBe("REVOKED");
    }
  });

  it("decideLink reports PARTY_INACTIVE when the requester was deactivated", async () => {
    const g = await mk("DISTRIBUTOR", "GiriC4");
    const r = await mk("CUSTOMER", "RamuC4");
    await as(r);
    await post("links", "/api/links", { targetId: g.id });
    const l = (await linkRow(g.id, r.id))!;
    await db.update(schema.users).set({ status: "REJECTED" }).where(eq(schema.users.id, r.id));
    await expect(links.decideLink(db, await full(g.id), l.id, "approve")).rejects.toMatchObject({ code: "PARTY_INACTIVE" });
    expect((await linkRow(g.id, r.id))?.status).toBe("PENDING");
  });

  it("requestLink by a non-active requester is PARTY_INACTIVE, not LINK_PENDING", async () => {
    const g = await mk("DISTRIBUTOR", "GiriC5");
    const r = await mk("CUSTOMER", "RamuC5", "PENDING");
    await expect(links.requestLink(db, await full(r.id), g.id)).rejects.toMatchObject({ code: "PARTY_INACTIVE", httpStatus: 403 });
  });

  it("personal names never appear: placeholder for missing business name, no search on name", async () => {
    const g = await mk("DISTRIBUTOR", "GiriPII");
    const secret = await mk("PROVIDER", "SecretPersonName");
    await db.update(schema.users).set({ businessName: null }).where(eq(schema.users.id, secret.id));
    const cust = await mk("CUSTOMER", "CustPII");
    await db.update(schema.users).set({ businessName: null }).where(eq(schema.users.id, cust.id));
    await as(g);
    const byName = await dirSvc.listProviderDirectory(db, await full(g.id), { q: "secretpersonname", page: 1, limit: 50 });
    expect(byName.rows).toHaveLength(0);
    const all = await dirSvc.listProviderDirectory(db, await full(g.id), { page: 1, limit: 50 });
    const row = all.rows.find((x) => x.id === secret.id)!;
    expect(row.businessName).toBe(`Unnamed provider (#${secret.id.slice(-4)})`);
    await post("links", "/api/links", { targetId: secret.id });
    await as(cust);
    await post("links", "/api/links", { targetId: g.id });
    await as(secret);
    const mine = JSON.stringify((await (await get("linksGet", "/api/links")).json()).data);
    expect(mine).not.toMatch(/GiriPII"/);
    await as(g);
    const gl = JSON.stringify((await (await get("linksGet", "/api/links")).json()).data);
    expect(gl).not.toMatch(/SecretPersonName/); // a provider's personal name never shows to a distributor
    expect(gl).toContain("CustPII"); // own customer: personal name fallback
    const other = await mk("DISTRIBUTOR", "OtherPII");
    await as(other);
    expect(JSON.stringify((await (await get("linksGet", "/api/links")).json()).data)).not.toMatch(/CustPII/);
    const od = JSON.stringify((await (await get("dirP", "/api/directory/providers?limit=50")).json()).data);
    expect(od).not.toMatch(/CustPII|SecretPersonName|GiriPII/);
    await as(cust);
    expect(JSON.stringify((await (await get("dirD", "/api/directory/distributors?limit=50")).json()).data)).not.toMatch(/CustPII/);
  });

  it("admin approve/reject routes are rate limited and size capped", async () => {
    const target = await mk("DISTRIBUTOR", "AdminTarget", "PENDING");
    const approveRoute = (await import("@/app/api/admin/users/[id]/approve/route")).POST as unknown as Route;
    await as(admin);
    const big = new Request(url("/api/admin/users/x/approve"), { method: "POST", body: "y".repeat(17 * 1024) });
    expect((await approveRoute(big, { params: Promise.resolve({ id: target.id }) })).status).toBe(413);
    expect((await full(target.id)).status).toBe("PENDING");
    let last = 0;
    for (let i = 0; i < 45 && last !== 429; i++) {
      last = (await approveRoute(new Request(url("/api/admin/users/x/approve"), { method: "POST" }), { params: Promise.resolve({ id: "missing" }) })).status;
    }
    expect(last).toBe(429);
  });
});

describe("cancel pending request", () => {
  let links: typeof import("@/server/services/links");
  let cancel: Route;
  beforeAll(async () => {
    links = await import("@/server/services/links");
    cancel = (await import("@/app/api/links/[id]/cancel/route")).POST as unknown as Route;
  });
  const postCancel = (id: string, body?: string) =>
    cancel(new Request(url(`/api/links/${id}/cancel`), { method: "POST", body }), { params: Promise.resolve({ id }) });

  it("requester cancels; the upper tier never sees it; re-request works immediately", async () => {
    const g = await mk("DISTRIBUTOR", "GiriCx1");
    const r = await mk("CUSTOMER", "RamuCx1");
    await as(r);
    await post("links", "/api/links", { targetId: g.id });
    const l = (await linkRow(g.id, r.id))!;
    expect((await postCancel(l.id)).status).toBe(200);
    expect(await linkRow(g.id, r.id)).toMatchObject({ status: "REVOKED", revokedBy: null });
    expect((await linkRow(g.id, r.id))?.decidedAt).toBeTruthy();
    expect((await (await get("linksGet", "/api/links")).json()).data).toHaveLength(0);
    await as(g);
    expect((await (await get("linksGet", "/api/links")).json()).data).toHaveLength(0);
    await as(r);
    expect((await post("links", "/api/links", { targetId: g.id })).status).toBe(201); // no cooldown
    expect(await linkRow(g.id, r.id)).toMatchObject({ id: l.id, status: "PENDING" });
  });

  it("upper party, stranger and non-pending links are refused", async () => {
    const g = await mk("DISTRIBUTOR", "GiriCx2");
    const r = await mk("CUSTOMER", "RamuCx2");
    const stranger = await mk("CUSTOMER", "StrangerCx2");
    await as(r);
    await post("links", "/api/links", { targetId: g.id });
    const l = (await linkRow(g.id, r.id))!;
    await as(g);
    expect((await postCancel(l.id)).status).toBe(404); // upper party is not the requester
    await as(stranger);
    expect((await postCancel(l.id)).status).toBe(404);
    expect((await postCancel("no-such-link")).status).toBe(404);
    expect((await linkRow(g.id, r.id))?.status).toBe("PENDING");
    // provider role is not allowed at all
    const p = await mk("PROVIDER", "ProvCx2");
    await as(p);
    expect((await postCancel(l.id)).status).toBe(403);
    // non-pending: active and rejected -> 409
    await as(g);
    await post("approve", `/api/links/${l.id}/approve`, undefined, l.id);
    await as(r);
    const act = await postCancel(l.id);
    expect(act.status).toBe(409);
    expect((await act.json()).code).toBe("INVALID_STATE");
    const r2 = await mk("CUSTOMER", "RamuCx2b");
    await as(r2);
    await post("links", "/api/links", { targetId: g.id });
    const l2 = (await linkRow(g.id, r2.id))!;
    await as(g);
    await post("reject", `/api/links/${l2.id}/reject`, undefined, l2.id);
    await as(r2);
    expect((await postCancel(l2.id)).status).toBe(409);
    expect((await linkRow(g.id, r2.id))?.status).toBe("REJECTED"); // cancel cannot dodge the cooldown
  });

  it("Origin, 16KB, rate limit and double cancel", async () => {
    const g = await mk("DISTRIBUTOR", "GiriCx3");
    const r = await mk("CUSTOMER", "RamuCx3");
    await as(r);
    await post("links", "/api/links", { targetId: g.id });
    const l = (await linkRow(g.id, r.id))!;
    state.headers = new Headers({ origin: "http://evil.com" });
    expect((await postCancel(l.id)).status).toBe(403);
    state.headers = new Headers({ origin: APP });
    expect((await postCancel(l.id, "y".repeat(17 * 1024))).status).toBe(413);
    expect((await linkRow(g.id, r.id))?.status).toBe("PENDING");
    const res = await Promise.allSettled([links.cancelLink(db, await db.select().from(schema.users).where(eq(schema.users.id, r.id)).then((x) => x[0]), l.id), postCancel(l.id)]);
    expect(res.filter((x) => x.status === "fulfilled" && (x.value as Response | undefined)?.status !== 409 && (x.value as Response | undefined)?.status !== 404).length).toBeGreaterThanOrEqual(1);
    expect((await linkRow(g.id, r.id))?.status).toBe("REVOKED");
    // rate limit shares the act:link bucket
    let last = 0;
    for (let i = 0; i < 45 && last !== 429; i++) last = (await postCancel("missing")).status;
    expect(last).toBe(429);
  });

  it("an upper-tier party still sees a link that was revoked after being active", async () => {
    const g = await mk("DISTRIBUTOR", "GiriCx4");
    const r = await mk("CUSTOMER", "RamuCx4");
    await as(admin);
    await post("force", "/api/admin/links", { upperId: g.id, lowerId: r.id });
    const l = (await linkRow(g.id, r.id))!;
    await as(r);
    await post("revoke", `/api/links/${l.id}/revoke`, undefined, l.id);
    await as(g);
    expect((await (await get("linksGet", "/api/links")).json()).data[0].status).toBe("REVOKED");
  });
});
