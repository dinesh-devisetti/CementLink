import type { Db } from "../db/client";
import { getConfig } from "../config";
import { rateLimitError } from "../services/users";
import { purgeOldAttempts, reserveAttempts } from "./rate-limit";

/** Per-actor, per-scope limit (ACTION_MAX_PER_MIN, 1-minute window) for mutating endpoints. Throws 429. */
export async function enforceActionLimit(db: Db, scope: string, actorId: string): Promise<void> {
  const r = await reserveAttempts(db, [`act:${scope}:${actorId}`], {
    maxAttempts: getConfig().ACTION_MAX_PER_MIN,
    windowMinutes: 1,
  });
  // Opportunistic cleanup (~1% of calls) so act: buckets do not pile up if nobody logs in.
  if (Math.random() < 0.01) void purgeOldAttempts(db).catch(() => undefined);
  if (!r.allowed) throw rateLimitError(r.retryAfterSec);
}
