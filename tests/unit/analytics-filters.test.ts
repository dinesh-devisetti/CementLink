import { describe, expect, it } from "vitest";
import { parseAnalyticsFilters, SEARCH_MAX } from "@/lib/validation/admin-analytics";
import { istRangeMs, likePattern } from "@/server/services/analytics-filters";

describe("parseAnalyticsFilters", () => {
  it("defaults to no filter", () => {
    expect(parseAnalyticsFilters({})).toEqual({ q: null, from: null, to: null });
  });
  it("trims, caps and strips control chars from q", () => {
    expect(parseAnalyticsFilters({ q: "  giri\u0000 " }).q).toBe("giri");
    expect(parseAnalyticsFilters({ q: "x".repeat(500) }).q).toHaveLength(SEARCH_MAX);
    const emoji = parseAnalyticsFilters({ q: "😀".repeat(500) }).q!;
    expect(Array.from(emoji)).toHaveLength(SEARCH_MAX);
    expect(emoji).not.toMatch(/[\ud800-\udbff](?![\udc00-\udfff])/);
    expect(parseAnalyticsFilters({ q: "   " }).q).toBeNull();
    expect(parseAnalyticsFilters({ q: 5 }).q).toBeNull();
  });
  it("takes the first of repeated params", () => {
    expect(parseAnalyticsFilters({ q: ["a", "b"] }).q).toBe("a");
  });
  it("accepts valid days and rejects impossible ones", () => {
    expect(parseAnalyticsFilters({ from: "2026-01-05", to: "2026-01-05" })).toMatchObject({ from: "2026-01-05", to: "2026-01-05" });
    expect(parseAnalyticsFilters({ from: "2026-02-30" }).from).toBeNull();
    expect(parseAnalyticsFilters({ from: "nope", to: "2026-1-1" })).toEqual({ q: null, from: null, to: null });
    expect(parseAnalyticsFilters({ to: "2026-01-05" }).to).toBe("2026-01-05");
  });
  it("drops the range when from > to", () => {
    expect(parseAnalyticsFilters({ from: "2026-03-02", to: "2026-03-01" })).toEqual({ q: null, from: null, to: null });
  });
});

describe("istRangeMs / likePattern", () => {
  it("covers IST days inclusively", () => {
    const { start, end } = istRangeMs({ from: "2026-01-10", to: "2026-01-10" });
    expect(start).toBe(Date.UTC(2026, 0, 9, 18, 30));
    expect(end).toBe(Date.UTC(2026, 0, 10, 18, 30));
    expect(istRangeMs({ from: null, to: null })).toEqual({ start: null, end: null });
  });
  it("escapes LIKE wildcards", () => {
    expect(likePattern("50%_a\\")).toBe("%50\\%\\_a\\\\%");
  });
});
