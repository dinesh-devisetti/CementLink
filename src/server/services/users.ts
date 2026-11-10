import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { Db } from "../db/client";
import { users, type Role, type User } from "../db/schema";
import { hashPassword, verifyPassword } from "../auth/password";
import { purgeOldAttempts, type LimitKey, releaseAttempts, reserveAttempts, type RateLimitOptions } from "../auth/rate-limit";
import { AppError } from "../errors";
import type { LoginInput, RegisterInput } from "@/lib/validation/auth";

export type PublicUser = Pick<User, "id" | "email" | "role" | "status" | "name">;

export function toPublicUser(u: User): PublicUser {
  return { id: u.id, email: u.email, role: u.role, status: u.status, name: u.name };
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string; extendedCode?: string } };
  const codes = [e?.code, e?.cause?.code, e?.cause?.extendedCode];
  return codes.some((c) => c === "SQLITE_CONSTRAINT_UNIQUE" || c === "SQLITE_CONSTRAINT_PRIMARYKEY");
}

export async function registerUser(db: Db, input: RegisterInput, now = Date.now()): Promise<User> {
  if ((input.role as string) === "ADMIN") throw new AppError("FORBIDDEN_ROLE", "Role not allowed", 400);
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, input.email)).limit(1);
  if (existing.length > 0) throw new AppError("EMAIL_TAKEN", "An account with this email already exists", 409);

  const isCustomer = input.role === "CUSTOMER";
  const row = {
    id: uuidv7(),
    email: input.email,
    passwordHash: await hashPassword(input.password),
    role: input.role as Role,
    status: isCustomer ? ("ACTIVE" as const) : ("PENDING" as const),
    name: input.name,
    businessName: isCustomer ? null : (input.businessName ?? null),
    phone: input.phone,
    city: isCustomer ? null : (input.city ?? null),
    createdAt: now,
  };
  try {
    await db.insert(users).values(row);
  } catch (err) {
    // only a unique(email) violation (lost a race) maps to 409; anything else is a real failure
    if (isUniqueViolation(err)) {
      throw new AppError("EMAIL_TAKEN", "An account with this email already exists", 409);
    }
    throw err;
  }
  return row;
}

// Lazily computed valid argon2id hash, verified against when the email is unknown so timing is similar.
let dummyHash: Promise<string> | undefined;
const getDummyHash = () => (dummyHash ??= hashPassword("dummy-password-for-timing"));

export function rateLimitError(retryAfterSec: number): AppError {
  const minutes = Math.max(1, Math.ceil(retryAfterSec / 60));
  return new AppError(
    "RATE_LIMITED",
    `Too many attempts, try again in ${minutes} minute${minutes === 1 ? "" : "s"}`,
    429,
    retryAfterSec,
  );
}

/** ip is null when no trustworthy client IP is available; then only the email key is limited. */
export async function authenticate(
  db: Db,
  input: LoginInput,
  ip: string | null,
  limit: RateLimitOptions & { ipMaxAttempts?: number },
  now = Date.now(),
): Promise<User> {
  const emailKey = `email:${input.email}`;
  const keys: LimitKey[] = [
    { key: emailKey },
    ...(ip ? [{ key: `ip:${ip}`, max: limit.ipMaxAttempts ?? limit.maxAttempts }] : []),
  ];
  const reservation = await reserveAttempts(db, keys, limit, now);
  if (!reservation.allowed) throw rateLimitError(reservation.retryAfterSec);

  const rows = await db.select().from(users).where(eq(users.email, input.email)).limit(1);
  const user = rows[0];
  const ok = await verifyPassword(user ? user.passwordHash : await getDummyHash(), input.password);
  if (!user || !ok) throw new AppError("BAD_CREDENTIALS", "Email or password is wrong", 401);

  // Refund only the email key: refunding the ip key would let one IP alternate bad guesses with its own good login.
  await releaseAttempts(db, [emailKey], limit, now);
  void purgeOldAttempts(db, now).catch(() => undefined);
  return user;
}

/** Idempotent admin bootstrap used by scripts/seed.ts. Never reachable through the API. */
export async function seedAdmin(db: Db, email: string, password: string, now = Date.now()): Promise<boolean> {
  const e = email.trim().toLowerCase();
  const existing = await db.select({ id: users.id }).from(users).where(eq(users.email, e)).limit(1);
  if (existing.length > 0) return false;
  await db.insert(users).values({
    id: uuidv7(),
    email: e,
    passwordHash: await hashPassword(password),
    role: "ADMIN",
    status: "ACTIVE",
    name: "Administrator",
    createdAt: now,
  });
  return true;
}
