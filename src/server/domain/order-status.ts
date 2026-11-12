import type { OrderStatus, PoStatus } from "../db/schema";

/** Order statuses that are driven by the status of their purchase orders. Every other status is left as is. */
const ROLLUP_FROM: ReadonlySet<OrderStatus> = new Set<OrderStatus>(["UNDER_REVIEW", "POS_PLACED", "DISPATCHED"]);
const DISPATCHED_OR_LATER: ReadonlySet<PoStatus> = new Set<PoStatus>(["DISPATCHED", "INVOICED", "PAID"]);

/**
 * Order status rollup (ADR-001 section 6.3), the pure spec for the SQL rollup UPDATEs.
 * `poStatuses` lists the status of the parent PO of every item of the order. REJECTED POs are not live and ignored.
 *  - no live item, or any live DRAFT item -> UNDER_REVIEW
 *  - every live item in a DISPATCHED/INVOICED/PAID PO -> DISPATCHED
 *  - otherwise (PLACED/ACCEPTED mixed in) -> POS_PLACED
 * Statuses outside the rollup (REQUESTED, DELIVERED, INVOICED, PAID, REJECTED, CANCELLED) are returned unchanged.
 */
export function computeOrderStatus(current: OrderStatus, poStatuses: readonly PoStatus[]): OrderStatus {
  if (!ROLLUP_FROM.has(current)) return current;
  const live = poStatuses.filter((s) => s !== "REJECTED");
  if (live.length === 0 || live.some((s) => s === "DRAFT")) return "UNDER_REVIEW";
  if (live.every((s) => DISPATCHED_OR_LATER.has(s))) return "DISPATCHED";
  return "POS_PLACED";
}
