import { describe, expect, it } from "vitest";
import { placeBlockReason } from "@/lib/draft-rules";

const item = (orderQtyKg: number, orderCoverageKg: number) => ({ orderId: "order-abcd", orderQtyKg, orderCoverageKg });

describe("placeBlockReason", () => {
  it("needs a selection", () => expect(placeBlockReason([])).toMatch(/Select/));
  it("blocks on a NULL provider", () => expect(placeBlockReason([{ providerId: null, items: [item(1000, 1000)] }])).toMatch(/Choose a provider/));
  it("blocks on a coverage mismatch with the order and both quantities", () => {
    expect(placeBlockReason([{ providerId: "p", items: [item(30000, 25000)] }])).toBe("Order #abcd needs 30 t, drafts total 25 t.");
  });
  it("allows a complete selection", () => expect(placeBlockReason([{ providerId: "p", items: [item(15000, 15000)] }])).toBeNull());
});
