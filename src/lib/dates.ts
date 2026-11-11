const IST_OFFSET_MS = 330 * 60_000;

/** Calendar date (YYYY-MM-DD) in India for an epoch-ms timestamp. */
export function istDate(ms: number): string {
  if (!Number.isFinite(ms)) throw new Error("Invalid timestamp");
  return new Date(ms + IST_OFFSET_MS).toISOString().slice(0, 10);
}

/** Today's calendar date in India (YYYY-MM-DD). */
export function todayIst(now: Date = new Date()): string {
  return istDate(now.getTime());
}
