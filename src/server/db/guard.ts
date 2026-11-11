import { sql, type SQL } from "drizzle-orm";
import type { Db } from "./client";

export const ASSERT_FAILED = "ASSERT_FAILED";

/**
 * A guard_assert insert. `condition` is a boolean SQL expression (may contain scalar subqueries).
 * VALUES((CASE ...)) is used instead of INSERT...SELECT...WHERE so an empty select can never silently pass.
 * NULL or 0 makes the INSTEAD OF trigger RAISE(ABORT, 'ASSERT_FAILED'), rolling back the whole batch.
 */
export function assertSql(condition: SQL): SQL {
  return sql`INSERT INTO guard_assert (ok) VALUES ((CASE WHEN (${condition}) THEN 1 ELSE 0 END))`;
}

type Statement = Parameters<Db["batch"]>[0][number];

/**
 * Run statements in one libSQL transaction. Put an assertSql(pre) first, the writes next, and
 * post-condition asserts last. Raw SQL fragments are wrapped with db.run. On failure the batch has fully
 * rolled back; callers test isAssertFailure(e) and diagnose with a read.
 */
export async function guardedBatch(db: Db, items: ReadonlyArray<Statement | SQL>): Promise<unknown[]> {
  if (items.length === 0) throw new Error("guardedBatch needs at least one statement");
  const stmts = items.map((i) => (isSql(i) ? db.run(i) : i)) as Statement[];
  return db.batch(stmts as [Statement, ...Statement[]]);
}

function isSql(x: unknown): x is SQL {
  return typeof x === "object" && x !== null && "queryChunks" in x;
}

/** True when the error (or any .cause) is the guard_assert abort. */
export function isAssertFailure(err: unknown): boolean {
  for (let e: unknown = err, depth = 0; e && depth < 6; depth++) {
    if (e instanceof Error && e.message.includes(ASSERT_FAILED)) return true;
    e = (e as { cause?: unknown }).cause;
  }
  return false;
}
