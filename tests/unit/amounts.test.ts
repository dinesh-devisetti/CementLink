import { describe, expect, it } from "vitest";
import { istDate, todayIst } from "@/lib/dates";
import { amountPaise } from "@/server/domain/amounts";

describe("amountPaise (round half up)", () => {
  it.each([
    [30_000, 650_000, 19_500_000], // 30 t x Rs 6,500
    [1, 1, 0], // 0.001 t x 1 paise: 0.001 -> rounds to 0
    [500, 1, 1], // exactly .5 rounds up
    [499, 1, 0],
    [1, 500, 1], // 0.5 paise rounds up
    [1, 499, 0],
    [1, 1500, 2], // 1.5 -> 2
    [1_000_000, 10_000_000, 10_000_000_000], // max values
    [333, 650_001, 216_450], // 216450.333 -> down
    [1001, 500, 501], // 500.5 -> up
  ])("%d kg @ %d -> %d", (kg, rate, expected) => expect(amountPaise(kg, rate)).toBe(expected));

  it.each([
    [0, 100],
    [-1, 100],
    [1.5, 100],
    [1_000_001, 100],
    [100, 0],
    [100, 10_000_001],
    [100, 1.2],
  ])("rejects %d kg @ %d", (kg, rate) => expect(() => amountPaise(kg, rate)).toThrow());
});

describe("IST dates", () => {
  it("rolls to next day after 18:30 UTC", () => {
    expect(todayIst(new Date("2026-11-10T18:29:59Z"))).toBe("2026-11-10");
    expect(todayIst(new Date("2026-11-10T18:30:00Z"))).toBe("2026-11-11");
  });
  it("istDate rejects non-finite", () => expect(() => istDate(NaN)).toThrow());
});
