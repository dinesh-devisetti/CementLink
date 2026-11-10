import { tonnesToBags } from "./qty";

/** Zod-free quantity/date helpers so client bundles (the request form) do not pull in zod. */
export const MAX_TOTAL_BAGS = 100_000;
export const WHOLE_BAGS = "Must be a whole number of bags";

export type QtyUnit = "BAGS" | "TONNES";

/** Today's calendar date in India (YYYY-MM-DD). */
export function todayIst(now: Date = new Date()): string {
  return new Date(now.getTime() + 330 * 60_000).toISOString().slice(0, 10);
}

/** Convert the entered quantity to whole bags. Throws Error(message) when not whole/positive. */
export function resolveTotalBags(unit: QtyUnit, quantity: string): number {
  if (unit === "BAGS") {
    if (!/^\d{1,7}$/.test(quantity)) throw new Error(WHOLE_BAGS);
    const n = Number(quantity);
    if (n <= 0) throw new Error("Quantity must be positive");
    return n;
  }
  try {
    return tonnesToBags(quantity);
  } catch {
    throw new Error(WHOLE_BAGS);
  }
}
