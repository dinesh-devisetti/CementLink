import { and, eq, lt, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { loginAttempts } from "../db/schema";

export interface RateLimitOptions {
  maxAttempts: number;
  windowMinutes: number;
}

/** A key to limit; max overrides opts.maxAttempts for this key. */
export interface LimitKey {
  key: string;
  max?: number;
}

export interface Reservation {
  allowed: boolean;
  retryAfterSec: number;
}

function windowBounds(now: number, windowMinutes: number) {
  const size = windowMinutes * 60_000;
  const start = Math.floor(now / size) * size;
  return { start, end: start + size };
}

/**
 * Atomically reserves one attempt on every key (upsert count+1 RETURNING count).
 * Reserving before the expensive password check means concurrent requests cannot all slip under the limit.
 */
export async function reserveAttempts(
  db: Db,
  keys: Array<string | LimitKey>,
  opts: RateLimitOptions,
  now = Date.now(),
): Promise<Reservation> {
  const { start, end } = windowBounds(now, opts.windowMinutes);
  let allowed = true;
  for (const k of keys) {
    const { key, max = opts.maxAttempts } = typeof k === "string" ? { key: k } : k;
    const rows = await db
      .insert(loginAttempts)
      .values({ key, windowStart: start, count: 1 })
      .onConflictDoUpdate({
        target: [loginAttempts.key, loginAttempts.windowStart],
        set: { count: sql`${loginAttempts.count} + 1` },
      })
      .returning({ count: loginAttempts.count });
    if ((rows[0]?.count ?? 1) > max) allowed = false;
  }
  return { allowed, retryAfterSec: Math.max(1, Math.ceil((end - now) / 1000)) };
}

/** Gives back a reserved attempt (used after a successful login so successes do not eat the budget). */
export async function releaseAttempts(db: Db, keys: string[], opts: RateLimitOptions, now = Date.now()): Promise<void> {
  const { start } = windowBounds(now, opts.windowMinutes);
  for (const key of keys) {
    await db
      .update(loginAttempts)
      .set({ count: sql`max(${loginAttempts.count} - 1, 0)` })
      .where(and(eq(loginAttempts.key, key), eq(loginAttempts.windowStart, start)));
  }
}

/** Drops buckets from windows that ended more than a day ago. */
export async function purgeOldAttempts(db: Db, now = Date.now()): Promise<void> {
  await db.delete(loginAttempts).where(lt(loginAttempts.windowStart, now - 86_400_000));
}
