import { describe, expect, it } from "vitest";
import { MAX_TOTAL_BAGS, resolveTotalBags, todayIst } from "@/lib/qty-input";

describe("qty-input (zod-free)", () => {
  it("converts and validates", () => {
    expect(resolveTotalBags("TONNES", "2.5")).toBe(50);
    expect(resolveTotalBags("BAGS", "7")).toBe(7);
    expect(() => resolveTotalBags("BAGS", "0")).toThrow();
    expect(MAX_TOTAL_BAGS).toBe(100_000);
    expect(todayIst(new Date("2026-11-03T20:00:00Z"))).toBe("2026-11-04");
  });
  it("does not import zod", async () => {
    const { readFileSync } = await import("node:fs");
    expect(readFileSync("src/lib/qty-input.ts", "utf8")).not.toMatch(/from "zod"/);
  });
});
