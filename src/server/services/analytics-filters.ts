import { sql, type SQL } from "drizzle-orm";
import type { AnalyticsFilters } from "@/lib/validation/admin-analytics";

const IST_OFFSET_MS = 330 * 60_000;
const DAY_MS = 86_400_000;

/** Epoch-ms half-open window [start, end) covering the IST calendar days from..to inclusive. Null bound = open. */
export function istRangeMs(f: Pick<AnalyticsFilters, "from" | "to">): { start: number | null; end: number | null } {
  const dayStart = (d: string) => Date.parse(`${d}T00:00:00Z`) - IST_OFFSET_MS;
  return { start: f.from ? dayStart(f.from) : null, end: f.to ? dayStart(f.to) + DAY_MS : null };
}

/** `LIKE` pattern matching the text anywhere; %, _ and \ in user text are literal (use with ESCAPE '\'). */
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

/** AND-joined conditions (empty => TRUE). All values are bound parameters. */
export function allOf(parts: SQL[]): SQL {
  return parts.length === 0 ? sql`1 = 1` : sql.join(parts, sql` AND `);
}

/** Case-insensitive (ASCII) substring match on any of the columns. */
export function searchAny(q: string | null, cols: SQL[]): SQL[] {
  if (!q) return [];
  const pat = likePattern(q);
  return [sql`(${sql.join(cols.map((c) => sql`${c} LIKE ${pat} ESCAPE '\\'`), sql` OR `)})`];
}

/** created_at (epoch ms) within the IST day range. */
export function epochInRange(col: SQL, f: Pick<AnalyticsFilters, "from" | "to">): SQL[] {
  const { start, end } = istRangeMs(f);
  return [...(start === null ? [] : [sql`${col} >= ${start}`]), ...(end === null ? [] : [sql`${col} < ${end}`])];
}

/** YYYY-MM-DD text column within from..to inclusive. */
export function dayInRange(col: SQL, f: Pick<AnalyticsFilters, "from" | "to">): SQL[] {
  return [...(f.from ? [sql`${col} >= ${f.from}`] : []), ...(f.to ? [sql`${col} <= ${f.to}`] : [])];
}
