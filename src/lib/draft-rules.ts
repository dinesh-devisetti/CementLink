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
