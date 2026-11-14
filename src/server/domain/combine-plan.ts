/** Pure planner for combining DRAFT POs of one provider (ADR-001 6.5). No DB access. */

export interface CombineItem {
  id: string;
  orderId: string;
  qtyKg: number;
  createdAt: number;
}
export interface CombinePo {
  id: string;
  createdAt: number;
  items: readonly CombineItem[];
}
/** What happens to one source order's items. `keepItemId` ends up in the target PO holding `qtyKg`. */
export interface CombineOrderStep {
  orderId: string;
  keepItemId: string;
  moveToTarget: boolean;
  qtyKg: number;
  deleteItemIds: string[];
}
export interface CombinePlan {
  targetId: string;
  steps: CombineOrderStep[];
  emptiedPoIds: string[];
}

const byAge = <T extends { createdAt: number; id: string }>(a: T, b: T) => a.createdAt - b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/**
 * The oldest PO is the target. For each source order, items merge into the target's own item for that order if it
 * has one, else the oldest item is moved into the target and absorbs the others. Per-order quantity is preserved.
 */
export function planCombine(pos: readonly CombinePo[]): CombinePlan {
  if (pos.length < 2) throw new Error("combine needs at least two POs");
  const sorted = [...pos].sort(byAge);
  const target = sorted[0];
  const targetItemByOrder = new Map(target.items.map((i) => [i.orderId, i]));
  const all = sorted.flatMap((p) => [...p.items].sort(byAge).map((i) => ({ ...i, poId: p.id })));
  const orderIds = [...new Set(all.map((i) => i.orderId))];
  const steps = orderIds.map((orderId): CombineOrderStep => {
    const items = all.filter((i) => i.orderId === orderId);
    const own = targetItemByOrder.get(orderId);
    const keep = own ?? items[0];
    return {
      orderId,
      keepItemId: keep.id,
      moveToTarget: !own,
      qtyKg: items.reduce((s, i) => s + i.qtyKg, 0),
      deleteItemIds: items.filter((i) => i.id !== keep.id).map((i) => i.id),
    };
  });
  return { targetId: target.id, steps, emptiedPoIds: sorted.slice(1).map((p) => p.id) };
}
