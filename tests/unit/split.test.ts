import { describe, expect, it } from "vitest";
import { allocatedBags, remainingBags, splitEvenly, submitBlocker } from "@/lib/split";

describe("split helpers", () => {
  it("sums allocations, ignoring blanks and junk", () => {
    expect(allocatedBags({ a: "30", b: "20", c: "", d: "x", e: "-3", f: "2.5" })).toBe(50);
  });
  it("remaining = total - allocated, null when total unknown", () => {
    expect(remainingBags(50, { a: "30" })).toBe(20);
    expect(remainingBags(50, { a: "60" })).toBe(-10);
    expect(remainingBags(null, { a: "5" })).toBeNull();
  });
  it("splits evenly with the remainder on the first distributors", () => {
    expect(splitEvenly(50, ["a", "b", "c"])).toEqual({ a: "17", b: "17", c: "16" });
    expect(splitEvenly(2, ["a", "b", "c"])).toEqual({ a: "1", b: "1", c: "0" });
    expect(splitEvenly(10, [])).toEqual({});
  });
  it("explains why submit is blocked, null when ok", () => {
    expect(submitBlocker(null, {})).toMatch(/quantity/i);
    expect(submitBlocker(50, {})).toMatch(/distributor/i);
    expect(submitBlocker(50, { a: "30" })).toBe("20 bags left to allocate");
    expect(submitBlocker(50, { a: "60" })).toBe("10 bags over-allocated");
    expect(submitBlocker(50, { a: "50", b: "0" })).toMatch(/at least 1 bag/i);
    expect(submitBlocker(50, { a: "30", b: "20" })).toBeNull();
  });
});

import { mapServerFields } from "@/lib/split";

describe("mapServerFields", () => {
  it("keeps known fields, folds allocations.* into allocations, reports the rest as general", () => {
    const r = mapServerFields({
      pincode: "Pincode must be 6 digits",
      "allocations.0.bags": "Must be at least 1 bag",
      "allocations.1.distributorId": "Invalid id",
      _: "Invalid input",
      unit: "bad",
    });
    expect(r.fields).toEqual({ pincode: "Pincode must be 6 digits", allocations: "Must be at least 1 bag" });
    expect(r.general).toContain("Invalid input");
    expect(r.general).toContain("bad");
  });
  it("returns no general message when everything is mapped", () => {
    expect(mapServerFields({ city: "City is required" })).toEqual({ fields: { city: "City is required" }, general: null });
  });
});
