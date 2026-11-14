import { describe, expect, it } from "vitest";
import { combineBlockReason, placeBlockReason } from "@/lib/draft-rules";

const item = (orderQtyKg: number, orderCoverageKg: number) => ({ orderId: "order-abcd", orderQtyKg, orderCoverageKg });

describe("placeBlockReason", () => {
  it("needs a selection", () => expect(placeBlockReason([])).toMatch(/Select/));
  it("blocks on a NULL provider", () => expect(placeBlockReason([{ providerId: null, items: [item(1000, 1000)] }])).toMatch(/Choose a provider/));
  it("blocks on a coverage mismatch with the order and both quantities", () => {
    expect(placeBlockReason([{ providerId: "p", items: [item(30000, 25000)] }])).toBe("Order #abcd needs 30 t, drafts total 25 t.");
  });
  it("allows a complete selection", () => expect(placeBlockReason([{ providerId: "p", items: [item(15000, 15000)] }])).toBeNull());
});

describe("combineBlockReason", () => {
  it("needs two or more drafts", () => {
    expect(combineBlockReason([])).toMatch(/at least two/);
    expect(combineBlockReason([{ providerId: "p" }])).toMatch(/at least two/);
  });
  it("blocks NULL and mixed providers", () => {
    expect(combineBlockReason([{ providerId: "p" }, { providerId: null }])).toMatch(/Choose a provider/);
    expect(combineBlockReason([{ providerId: "p" }, { providerId: "q" }])).toBe("Select drafts of the same provider.");
  });
  it("blocks different non-null rates but allows one rate or none", () => {
    expect(combineBlockReason([{ providerId: "p", ratePerTonnePaise: 1 }, { providerId: "p", ratePerTonnePaise: 2 }])).toBe("Drafts have different rates.");
    expect(combineBlockReason([{ providerId: "p", ratePerTonnePaise: 1 }, { providerId: "p", ratePerTonnePaise: null }])).toBeNull();
  });
  it("allows the same provider", () => expect(combineBlockReason([{ providerId: "p" }, { providerId: "p" }])).toBeNull());
});
