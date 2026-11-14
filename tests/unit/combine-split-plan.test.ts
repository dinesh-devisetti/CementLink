import { describe, expect, it } from "vitest";
import { planCombine } from "@/server/domain/combine-plan";
import { planSplitBack } from "@/server/domain/split-plan";

const it_ = (id: string, orderId: string, qtyKg: number, createdAt = 1) => ({ id, orderId, qtyKg, createdAt });

describe("planCombine", () => {
  it("picks the oldest PO as target and moves other orders' items in", () => {
    const plan = planCombine([
      { id: "p2", createdAt: 20, items: [it_("i2", "oB", 5000, 20)] },
      { id: "p1", createdAt: 10, items: [it_("i1", "oA", 3000, 10)] },
    ]);
    expect(plan.targetId).toBe("p1");
    expect(plan.emptiedPoIds).toEqual(["p2"]);
    expect(plan.steps).toEqual([
      { orderId: "oA", keepItemId: "i1", moveToTarget: false, qtyKg: 3000, deleteItemIds: [] },
      { orderId: "oB", keepItemId: "i2", moveToTarget: true, qtyKg: 5000, deleteItemIds: [] },
    ]);
  });
  it("merges same-order items into the target's item and conserves per-order quantity", () => {
    const pos = [
      { id: "p1", createdAt: 10, items: [it_("a1", "oA", 3000, 10)] },
      { id: "p2", createdAt: 20, items: [it_("a2", "oA", 2000, 20), it_("b2", "oB", 1000, 20)] },
      { id: "p3", createdAt: 30, items: [it_("b3", "oB", 4000, 30), it_("a3", "oA", 500, 30)] },
    ];
    const plan = planCombine(pos);
    const a = plan.steps.find((s) => s.orderId === "oA")!;
    const b = plan.steps.find((s) => s.orderId === "oB")!;
    expect(a).toMatchObject({ keepItemId: "a1", moveToTarget: false, qtyKg: 5500, deleteItemIds: ["a2", "a3"] });
    expect(b).toMatchObject({ keepItemId: "b2", moveToTarget: true, qtyKg: 5000, deleteItemIds: ["b3"] });
    expect(plan.steps.reduce((s, x) => s + x.qtyKg, 0)).toBe(10500);
  });
  it("needs two POs", () => expect(() => planCombine([{ id: "p", createdAt: 1, items: [] }])).toThrow());
});

describe("planSplitBack", () => {
  it("moves the chosen items and leaves the rest", () => expect(planSplitBack(["a", "b", "c"], ["b"])).toEqual({ ok: true, move: ["b"], stay: ["a", "c"] }));
  it("rejects empty, duplicate, unknown and all-items choices", () => {
    expect(planSplitBack(["a", "b"], [])).toEqual({ ok: false, error: "EMPTY" });
    expect(planSplitBack(["a", "b"], ["a", "a"])).toEqual({ ok: false, error: "DUPLICATE" });
    expect(planSplitBack(["a", "b"], ["z"])).toEqual({ ok: false, error: "UNKNOWN_ITEM" });
    expect(planSplitBack(["a", "b"], ["a", "b"])).toEqual({ ok: false, error: "NOTHING_LEFT" });
  });
});
