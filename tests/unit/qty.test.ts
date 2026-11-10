import { describe, expect, it } from "vitest";
import { bagsToTonnes, formatQty, tonnesToBags, tripsFor } from "@/lib/qty";

describe("qty", () => {
  it("converts tonnes to bags", () => {
    expect(tonnesToBags("1")).toBe(20);
    expect(tonnesToBags("2.5")).toBe(50);
    expect(tonnesToBags("0.05")).toBe(1);
  });
  it("rejects non-multiples of 0.05 and bad strings", () => {
    for (const bad of ["0.01", "0.075", "abc", "-1", "0", ""]) {
      expect(() => tonnesToBags(bad)).toThrow();
    }
  });
  it("bagsToTonnes and formatQty", () => {
    expect(bagsToTonnes(50)).toBe("2.5");
    expect(formatQty(40)).toBe("40 bags (2 t)");
    expect(formatQty(1)).toBe("1 bags (0.05 t)");
  });
  it("tripsFor uses ceiling with integer math", () => {
    expect(tripsFor(200, 200)).toBe(1);
    expect(tripsFor(201, 200)).toBe(2);
    expect(tripsFor(0, 200)).toBe(0);
    expect(() => tripsFor(10, 0)).toThrow();
  });
});
