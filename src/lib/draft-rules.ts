import { formatTonnes } from "./qty";

/** Minimal shape needed to decide whether drafts may be placed (mirrors the server pre-asserts). */
export interface PlaceableDraft {
  providerId: string | null;
  items: Array<{ orderId: string; orderQtyKg: number | null; orderCoverageKg: number | null }>;
}

/** Reason Place must stay disabled for this selection, or null when it may go ahead. */
export function placeBlockReason(selected: readonly PlaceableDraft[]): string | null {
  if (selected.length === 0) return "Select the drafts to place.";
  if (selected.some((d) => !d.providerId)) return "Choose a provider for every selected draft.";
  for (const d of selected) {
    for (const i of d.items) {
      if (i.orderQtyKg !== null && i.orderCoverageKg !== null && i.orderQtyKg !== i.orderCoverageKg) {
        return `Order #${i.orderId.slice(-4)} needs ${formatTonnes(i.orderQtyKg)}, drafts total ${formatTonnes(i.orderCoverageKg)}.`;
      }
    }
  }
  return null;
}

/** Minimal shape needed to decide whether drafts may be combined (mirrors the server prechecks). */
export interface CombinableDraft {
  providerId: string | null;
  ratePerTonnePaise?: number | null;
}

/** Reason Combine must stay disabled for this selection, or null when it may go ahead. */
export function combineBlockReason(selected: readonly CombinableDraft[]): string | null {
  if (selected.length < 2) return "Select at least two drafts to combine.";
  if (selected.length > 20) return "Combine at most 20 drafts at a time.";
  if (selected.some((d) => !d.providerId)) return "Choose a provider for every draft you combine.";
  if (new Set(selected.map((d) => d.providerId)).size > 1) return "Select drafts of the same provider.";
  if (new Set(selected.map((d) => d.ratePerTonnePaise).filter((r) => r !== null && r !== undefined)).size > 1) return "Drafts have different rates.";
  return null;
}
