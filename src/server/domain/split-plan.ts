/** Pure validation for splitting items of a combined DRAFT PO back into a new PO (ADR-001 6.5). */

export type SplitBackError = "EMPTY" | "DUPLICATE" | "UNKNOWN_ITEM" | "NOTHING_LEFT";

export type SplitBackPlan = { ok: true; move: string[]; stay: string[] } | { ok: false; error: SplitBackError };

export const SPLIT_BACK_MESSAGES: Record<SplitBackError, string> = {
  EMPTY: "Select at least one item to split back",
  DUPLICATE: "Each item can appear only once",
  UNKNOWN_ITEM: "An item does not belong to this draft",
  NOTHING_LEFT: "At least one item must stay in the draft",
};

export function planSplitBack(poItemIds: readonly string[], chosen: readonly string[]): SplitBackPlan {
  if (chosen.length === 0) return { ok: false, error: "EMPTY" };
  if (new Set(chosen).size !== chosen.length) return { ok: false, error: "DUPLICATE" };
  const have = new Set(poItemIds);
  if (chosen.some((c) => !have.has(c))) return { ok: false, error: "UNKNOWN_ITEM" };
  const move = new Set(chosen);
  const stay = poItemIds.filter((i) => !move.has(i));
  if (stay.length === 0) return { ok: false, error: "NOTHING_LEFT" };
  return { ok: true, move: [...chosen], stay };
}
