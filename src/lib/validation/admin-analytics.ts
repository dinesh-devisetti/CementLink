import { z } from "zod";
import { limitSchema, pageSchema } from "./pagination";

/** Admin analytics list query: page <= MAX_PAGE, limit <= 50. Unknown params are ignored; bad values are 400. */
export const analyticsQuerySchema = z.object({ page: pageSchema, limit: limitSchema });

export function parseAnalyticsQuery(req: Request) {
  const sp = new URL(req.url).searchParams;
  return analyticsQuerySchema.parse({ page: sp.get("page") ?? undefined, limit: sp.get("limit") ?? undefined });
}

/** Max characters kept from the ?q= search text. */
export const SEARCH_MAX = 80;

export interface AnalyticsFilters {
  /** Trimmed, length-capped search text; null when absent or blank. */
  q: string | null;
  /** IST calendar days, inclusive; Either bound may be null; when both are set, from <= to. */
  from: string | null;
  to: string | null;
}
export const NO_FILTERS: AnalyticsFilters = { q: null, from: null, to: null };

const dayString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((s) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
});
const CONTROL = /[\u0000-\u001f\u007f]/g;

/**
 * Filters from raw query values. Never throws: an invalid field falls back to "no filter";
 * if from > to the whole date range is dropped.
 */
export function parseAnalyticsFilters(raw: { q?: unknown; from?: unknown; to?: unknown }): AnalyticsFilters {
  const first = (v: unknown) => (Array.isArray(v) ? v[0] : v);
  const qRaw = first(raw.q);
  const q = typeof qRaw === "string" ? Array.from(qRaw.replace(CONTROL, " ").trim()).slice(0, SEARCH_MAX).join("").trim() : "";
  const f = dayString.safeParse(first(raw.from));
  const t = dayString.safeParse(first(raw.to));
  const from = f.success ? f.data : null;
  const to = t.success ? t.data : null;
  const rangeOk = !(from && to && from > to);
  return { q: q === "" ? null : q, from: rangeOk ? from : null, to: rangeOk ? to : null };
}

export function parseAnalyticsFiltersFromRequest(req: Request): AnalyticsFilters {
  const sp = new URL(req.url).searchParams;
  return parseAnalyticsFilters({ q: sp.get("q") ?? undefined, from: sp.get("from") ?? undefined, to: sp.get("to") ?? undefined });
}
