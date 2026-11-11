import { describe, expect, it } from "vitest";
import { summarizeSplit } from "@/lib/split";

describe("summarizeSplit", () => {
  it("Case 1: 30 t = 10 + 20, nothing left for the distributor", () => {
    const s = summarizeSplit("30", [{ providerId: "a", tonnes: "10" }, { providerId: "b", tonnes: "20" }]);
    expect(s).toMatchObject({ totalKg: 30000, allocatedKg: 30000, remainderKg: 0, over: false, ok: true });
  });
  it("Case 2: no split, whole order is the distributor's choice", () => {
    const s = summarizeSplit("15", []);
    expect(s).toMatchObject({ totalKg: 15000, allocatedKg: 0, remainderKg: 15000, over: false, ok: true });
  });
  it("partial split leaves a remainder", () => {
    expect(summarizeSplit("15.5", [{ providerId: "a", tonnes: "5.25" }]).remainderKg).toBe(10250);
  });
  it("over-allocation is flagged with no negative remainder", () => {
    const s = summarizeSplit("10", [{ providerId: "a", tonnes: "6" }, { providerId: "b", tonnes: "5" }]);
    expect(s).toMatchObject({ over: true, remainderKg: 0, ok: false });
  });
  it("flags bad rows, duplicates and an invalid total without throwing", () => {
    expect(summarizeSplit("abc", []).ok).toBe(false);
    expect(summarizeSplit("abc", []).totalKg).toBeNull();
    const s = summarizeSplit("10", [{ providerId: "a", tonnes: "1.2345" }, { providerId: "a", tonnes: "1" }, { providerId: "", tonnes: "1" }]);
    expect(s.ok).toBe(false);
    expect(s.rowErrors[0]).toBeTruthy();
    expect(s.rowErrors[1]).toMatch(/once/);
    expect(s.rowErrors[2]).toMatch(/provider/i);
  });
  it("blank amount rows are ignored errors-wise only when the row has no provider", () => {
    expect(summarizeSplit("10", [{ providerId: "a", tonnes: "" }]).rowErrors[0]).toBeTruthy();
  });
});
