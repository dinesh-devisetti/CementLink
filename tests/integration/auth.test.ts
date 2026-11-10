import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import type { Db } from "@/server/db/client";
import { sessions, users } from "@/server/db/schema";
import { authenticate, registerUser, seedAdmin } from "@/server/services/users";
import { AppError } from "@/server/errors";
import { createSession, deleteSession, hashToken, resolveSession } from "@/server/auth/session";
import { verifyPassword } from "@/server/auth/password";
import { registerSchema } from "@/lib/validation/auth";
import { makeTestDb } from "./helpers";

let db: Db;
let cleanup: () => void;
const limit = { maxAttempts: 3, ipMaxAttempts: 8, windowMinutes: 15 };

const reg = (over: Record<string, unknown> = {}) =>
  registerSchema.parse({
    name: "Ravi",
    email: "Ravi@Example.com",
    password: "password123",
    role: "CUSTOMER",
    phone: "9876543210",
    ...over,
  });

beforeAll(async () => {
  ({ db, cleanup } = await makeTestDb());
});
afterAll(() => cleanup());

describe("registration", () => {
  it("customer is ACTIVE, email lowercased, password hashed with argon2id", async () => {
    const u = await registerUser(db, reg());
    expect(u.status).toBe("ACTIVE");
    expect(u.email).toBe("ravi@example.com");
    expect(u.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(u.passwordHash, "password123")).toBe(true);
  });
  it("distributor and provider are PENDING", async () => {
    const d = await registerUser(db, reg({ email: "d@x.com", role: "DISTRIBUTOR", businessName: "Sharma", city: "Pune" }));
    const p = await registerUser(db, reg({ email: "p@x.com", role: "PROVIDER", businessName: "UltraCo", city: "Mumbai" }));
    expect(d.status).toBe("PENDING");
    expect(p.status).toBe("PENDING");
  });
  it("service refuses ADMIN role even if validation is bypassed", async () => {
    await expect(registerUser(db, { ...reg(), email: "x@y.com", role: "ADMIN" as never })).rejects.toBeInstanceOf(AppError);
  });
  it("duplicate email -> 409", async () => {
    await expect(registerUser(db, reg())).rejects.toMatchObject({ code: "EMAIL_TAKEN", httpStatus: 409 });
  });
  it("schema rejects ADMIN role, extra fields, missing business for distributor, short password", () => {
    expect(registerSchema.safeParse({ ...reg(), role: "ADMIN" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...reg(), status: "ACTIVE" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...reg(), role: "DISTRIBUTOR" }).success).toBe(false);
    expect(registerSchema.safeParse({ ...reg(), password: "short" }).success).toBe(false);
  });
});

describe("login + rate limit", () => {
  const good = { password: "password123" };
  const mkUser = (email: string) => registerUser(db, reg({ email }));
  const bad = (email: string, ip: string | null, now?: number) =>
    authenticate(db, { email, password: "wrong" }, ip, limit, now);

  it("accepts good credentials and success does not consume the email budget", async () => {
    await mkUser("ok@example.com");
    for (let i = 0; i < 6; i++) {
      const u = await authenticate(db, { email: "ok@example.com", ...good }, "10.0.0.1", limit);
      expect(u.role).toBe("CUSTOMER");
    }
  });

  it("a successful login never refunds the ip key (no spraying via own good login)", async () => {
    await mkUser("attacker@example.com");
    const ip = "10.7.7.7";
    const now = Date.now();
    for (let i = 0; i < limit.ipMaxAttempts - 1; i++) {
      await expect(bad(`victim${i}@example.com`, ip, now)).rejects.toMatchObject({ code: "BAD_CREDENTIALS" });
    }
    // own good login consumes the last ip slot and must not give it back
    await authenticate(db, { email: "attacker@example.com", ...good }, ip, limit, now);
    await expect(bad("victim-x@example.com", ip, now)).rejects.toMatchObject({ code: "RATE_LIMITED" });
  });

  it("generic error for wrong password and unknown email", async () => {
    await mkUser("generic@example.com");
    for (const email of ["generic@example.com", "nobody@example.com"]) {
      await expect(bad(email, "10.0.0.2")).rejects.toMatchObject({ code: "BAD_CREDENTIALS", httpStatus: 401 });
    }
  });

  it("exactly max bad logins give 401, then 429 with retry info, even with the right password", async () => {
    await mkUser("lock@example.com");
    const now = Date.now();
    for (let i = 0; i < limit.maxAttempts; i++) {
      await expect(bad("lock@example.com", null, now)).rejects.toMatchObject({ code: "BAD_CREDENTIALS" });
    }
    const err = await authenticate(db, { email: "lock@example.com", ...good }, null, limit, now).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: "RATE_LIMITED", httpStatus: 429 });
    expect(err.retryAfterSec).toBeGreaterThan(0);
    expect(err.retryAfterSec).toBeLessThanOrEqual(15 * 60);
    expect(err.message).toMatch(/minute/);
  });

  it("IP key trips at exactly ipMaxAttempts across different emails, other IPs unaffected", async () => {
    const now = Date.now();
    for (let i = 0; i < limit.ipMaxAttempts; i++) {
      await expect(bad(`ghost${i}@example.com`, "10.9.9.9", now)).rejects.toMatchObject({ code: "BAD_CREDENTIALS" });
    }
    await expect(bad("ghost-new@example.com", "10.9.9.9", now)).rejects.toMatchObject({ code: "RATE_LIMITED" });
    await expect(bad("ghost-new@example.com", "10.9.9.8", now)).rejects.toMatchObject({ code: "BAD_CREDENTIALS" });
  });

  it("many successful logins from one IP for different users all succeed under the IP limit", async () => {
    for (let i = 0; i < limit.ipMaxAttempts; i++) {
      await mkUser(`shared${i}@example.com`);
      const u = await authenticate(db, { email: `shared${i}@example.com`, ...good }, "10.5.5.5", limit);
      expect(u.email).toBe(`shared${i}@example.com`);
    }
  });

  it("limit resets in the next window", async () => {
    await mkUser("reset@example.com");
    const now = Date.now();
    for (let i = 0; i < limit.maxAttempts; i++) await bad("reset@example.com", null, now).catch(() => undefined);
    const later = now + 16 * 60_000;
    const u = await authenticate(db, { email: "reset@example.com", ...good }, null, limit, later);
    expect(u.email).toBe("reset@example.com");
  });

  it("concurrent bad logins cannot exceed the budget", async () => {
    await mkUser("race@example.com");
    const results = await Promise.allSettled(Array.from({ length: 20 }, () => bad("race@example.com", null)));
    const codes = results.map((r) => (r.status === "rejected" ? (r.reason as AppError).code : "OK"));
    expect(codes.filter((c) => c === "BAD_CREDENTIALS").length).toBeLessThanOrEqual(limit.maxAttempts);
    expect(codes.filter((c) => c === "RATE_LIMITED").length).toBeGreaterThanOrEqual(20 - limit.maxAttempts);
  });
});

describe("sessions", () => {
  it("stores only the token hash, resolves, expires, and deletes", async () => {
    const [user] = await db.select().from(users).where(eq(users.email, "ravi@example.com"));
    const now = Date.now();
    const { token } = await createSession(db, user.id, 1, now);
    const rows = await db.select().from(sessions).where(eq(sessions.userId, user.id));
    expect(rows.some((r) => r.tokenHash === hashToken(token))).toBe(true);
    expect(rows.some((r) => r.tokenHash === token)).toBe(false);

    expect((await resolveSession(db, token, now + 1000))?.id).toBe(user.id);
    expect(await resolveSession(db, token, now + 2 * 3_600_000)).toBeNull();
    expect(await resolveSession(db, undefined)).toBeNull();
    expect(await resolveSession(db, "garbage")).toBeNull();

    await deleteSession(db, token);
    expect(await resolveSession(db, token, now + 1000)).toBeNull();
  });
  it("two logins give distinct tokens", async () => {
    const [user] = await db.select().from(users).where(eq(users.email, "ravi@example.com"));
    const a = await createSession(db, user.id, 1);
    const b = await createSession(db, user.id, 1);
    expect(a.token).not.toBe(b.token);
  });
});

describe("seedAdmin", () => {
  it("creates an ACTIVE admin once", async () => {
    expect(await seedAdmin(db, "Admin@Example.com", "AdminPass123!")).toBe(true);
    expect(await seedAdmin(db, "admin@example.com", "AdminPass123!")).toBe(false);
    const [a] = await db.select().from(users).where(eq(users.email, "admin@example.com"));
    expect(a).toMatchObject({ role: "ADMIN", status: "ACTIVE" });
  });
});
