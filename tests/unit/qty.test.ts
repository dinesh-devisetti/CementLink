import { describe, expect, it } from "vitest";
import { formatTonnes, kgToTonnes, tonnesToKg } from "@/lib/qty";

describe("tonnesToKg", () => {
  it.each([
    ["0.001", 1],
    ["1", 1000],
    ["10.5", 10_500],
    ["1.2", 1200],
    ["999.999", 999_999],
    ["1000", 1_000_000],
    ["1000.000", 1_000_000],
    ["0.5", 500],
  ])("accepts %s", (v, kg) => expect(tonnesToKg(v)).toBe(kg));

  it.each(["1000.001", "1.2345", "0", "0.000", "-1", "", " 1", "1 ", "1e3", "abc", "1,5", ".5", "5.", "10000", "1.2.3", "+1"])(
    "rejects %j",
    (v) => expect(() => tonnesToKg(v)).toThrow(),
  );

  it("rejects non-strings", () => {
    expect(() => tonnesToKg(5 as unknown as string)).toThrow();
  });
});

describe("kgToTonnes / formatTonnes", () => {
  it.each([
    [1, "0.001"],
    [500, "0.5"],
    [10_500, "10.5"],
    [1_000_000, "1000"],
    [0, "0"],
  ])("%d kg -> %s", (kg, t) => expect(kgToTonnes(kg)).toBe(t));
  it("formats with unit", () => expect(formatTonnes(10_500)).toBe("10.5 t"));
  it("rejects bad kg", () => {
    expect(() => kgToTonnes(1.5)).toThrow();
    expect(() => kgToTonnes(-1)).toThrow();
  });
  it("round-trips", () => {
    for (const kg of [1, 7, 999, 1000, 12_345, 1_000_000]) expect(tonnesToKg(kgToTonnes(kg))).toBe(kg);
  });
});
