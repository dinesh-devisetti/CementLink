import { describe, expect, it } from "vitest";
import { computeOrderStatus } from "@/server/domain/order-status";

describe("computeOrderStatus", () => {
  it("stays UNDER_REVIEW while any live item is still a draft", () => {
    expect(computeOrderStatus("UNDER_REVIEW", ["DRAFT", "DRAFT"])).toBe("UNDER_REVIEW");
    expect(computeOrderStatus("UNDER_REVIEW", ["PLACED", "DRAFT"])).toBe("UNDER_REVIEW");
  });
  it("is POS_PLACED once no draft remains and something is not yet dispatched", () => {
    expect(computeOrderStatus("UNDER_REVIEW", ["PLACED", "PLACED"])).toBe("POS_PLACED");
    expect(computeOrderStatus("POS_PLACED", ["ACCEPTED", "DISPATCHED"])).toBe("POS_PLACED");
  });
  it("is DISPATCHED when every live item is dispatched or later", () => {
    expect(computeOrderStatus("POS_PLACED", ["DISPATCHED", "INVOICED", "PAID"])).toBe("DISPATCHED");
  });
  it("ignores rejected POs and falls back to UNDER_REVIEW with no live item", () => {
    expect(computeOrderStatus("POS_PLACED", ["REJECTED", "PLACED"])).toBe("POS_PLACED");
    expect(computeOrderStatus("POS_PLACED", ["REJECTED"])).toBe("UNDER_REVIEW");
    expect(computeOrderStatus("UNDER_REVIEW", [])).toBe("UNDER_REVIEW");
  });
  it("never moves statuses outside the rollup", () => {
    for (const s of ["REQUESTED", "DELIVERED", "INVOICED", "PAID", "REJECTED", "CANCELLED"] as const) {
      expect(computeOrderStatus(s, ["DRAFT"])).toBe(s);
    }
  });
});
