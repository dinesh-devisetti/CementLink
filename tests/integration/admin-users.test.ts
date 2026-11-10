import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { registerUser, seedAdmin } from "@/server/services/users";
import { decideUser, listUsersByStatus } from "@/server/services/admin-users";
import { createSession } from "@/server/auth/session";
import { sessions, users } from "@/server/db/schema";
import { makeTestDb } from "./helpers";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
beforeAll(async () => {
  ctx = await makeTestDb();
});
afterAll(() => ctx.cleanup());

const reg = (email: string, role: "CUSTOMER" | "DISTRIBUTOR" | "PROVIDER") =>
  registerUser(ctx.db, { name: "N", email, password: "password123", role, phone: "9876543210", businessName: "B", city: "Pune" } as never);

describe("admin user decisions", () => {
  it("lists only users of the requested status, newest first, without hashes", async () => {
    const a = await reg("l1@x.com", "DISTRIBUTOR");
    const b = await reg("l2@x.com", "PROVIDER");
    await reg("l3@x.com", "CUSTOMER");
    const { rows: list } = await listUsersByStatus(ctx.db, "PENDING");
    const ids = list.map((u) => u.id);
    expect(ids).toEqual(expect.arrayContaining([a.id, b.id]));
    expect(list.every((u) => u.status === "PENDING")).toBe(true);
    expect(JSON.stringify(list)).not.toContain("argon2");
    expect(list[0]).not.toHaveProperty("passwordHash");
    expect(list[0]).not.toHaveProperty("phone");
  });

  it("pages results and reports the total", async () => {
    for (let i = 0; i < 3; i++) await reg(`pg${i}@x.com`, "PROVIDER");
    const all = await listUsersByStatus(ctx.db, "PENDING", { page: 1, limit: 50 });
    const first = await listUsersByStatus(ctx.db, "PENDING", { page: 1, limit: 2 });
    const second = await listUsersByStatus(ctx.db, "PENDING", { page: 2, limit: 2 });
    expect(first.rows).toHaveLength(2);
    expect(first.total).toBe(all.total);
    expect(second.rows[0].id).toBe(all.rows[2].id);
  });

  it("approve sets ACTIVE and leaves sessions alone", async () => {
    const u = await reg("ap@x.com", "DISTRIBUTOR");
    const other = await reg("ap-other@x.com", "PROVIDER");
    await createSession(ctx.db, u.id, 1);
    await createSession(ctx.db, other.id, 1);
    const res = await decideUser(ctx.db, u.id, "approve");
    expect(res.status).toBe("ACTIVE");
    expect(await ctx.db.select().from(sessions).where(eq(sessions.userId, u.id))).toHaveLength(1);
    expect(await ctx.db.select().from(sessions).where(eq(sessions.userId, other.id))).toHaveLength(1);
  });

  it("reject sets REJECTED and deletes sessions", async () => {
    const u = await reg("rj@x.com", "PROVIDER");
    await createSession(ctx.db, u.id, 1);
    expect((await decideUser(ctx.db, u.id, "reject")).status).toBe("REJECTED");
    expect(await ctx.db.select().from(sessions).where(eq(sessions.userId, u.id))).toHaveLength(0);
  });

  it("a rejected user can later be approved", async () => {
    const u = await reg("rj2@x.com", "PROVIDER");
    await decideUser(ctx.db, u.id, "reject");
    expect((await decideUser(ctx.db, u.id, "approve")).status).toBe("ACTIVE");
  });

  it("reject deletes only the target's sessions", async () => {
    const u = await reg("rjs@x.com", "PROVIDER");
    const o = await reg("rjs-o@x.com", "PROVIDER");
    await createSession(ctx.db, u.id, 1);
    await createSession(ctx.db, o.id, 1);
    await decideUser(ctx.db, u.id, "reject");
    expect(await ctx.db.select().from(sessions).where(eq(sessions.userId, o.id))).toHaveLength(1);
  });

  it("status update and session delete are atomic (rolled back if delete fails)", async () => {
    const u = await reg("atom@x.com", "PROVIDER");
    await createSession(ctx.db, u.id, 1);
    await ctx.db.run(sql`CREATE TRIGGER fail_del BEFORE DELETE ON sessions BEGIN SELECT RAISE(ABORT, 'boom'); END`);
    try {
      await expect(decideUser(ctx.db, u.id, "reject")).rejects.toThrow();
    } finally {
      await ctx.db.run(sql`DROP TRIGGER fail_del`);
    }
    const [after] = await ctx.db.select().from(users).where(eq(users.id, u.id));
    expect(after.status).toBe("PENDING");
  });

  it("unknown id -> 404 NOT_FOUND", async () => {
    await expect(decideUser(ctx.db, "nope", "approve")).rejects.toMatchObject({ code: "NOT_FOUND", httpStatus: 404 });
  });

  it("ADMIN accounts cannot be approved or rejected", async () => {
    await seedAdmin(ctx.db, "adm@x.com", "AdminPass123!");
    const [admin] = await ctx.db.select().from(users).where(eq(users.email, "adm@x.com"));
    for (const d of ["approve", "reject"] as const) {
      await expect(decideUser(ctx.db, admin.id, d)).rejects.toMatchObject({ code: "INVALID_TARGET", httpStatus: 409 });
    }
    const [after] = await ctx.db.select().from(users).where(eq(users.id, admin.id));
    expect(after.status).toBe("ACTIVE");
  });

  it("customers are not subject to approval", async () => {
    const c = await reg("cu@x.com", "CUSTOMER");
    await expect(decideUser(ctx.db, c.id, "reject")).rejects.toMatchObject({ code: "INVALID_TARGET" });
    const [after] = await ctx.db.select().from(users).where(eq(users.id, c.id));
    expect(after.status).toBe("ACTIVE");
  });
});
