import { describe, expect, it } from "vitest";
import { formatPaise, parseRupeesToPaise } from "@/lib/money";

describe("parseRupeesToPaise", () => {
  it("parses whole and decimal rupees", () => {
    expect(parseRupeesToPaise("385")).toBe(38500);
    expect(parseRupeesToPaise("385.5")).toBe(38550);
    expect(parseRupeesToPaise("385.50")).toBe(38550);
    expect(parseRupeesToPaise("0.07")).toBe(7);
  });
  it("rejects bad input", () => {
    for (const bad of ["", "abc", "-1", "1.234", "12345678", "1e3", " 5", "5.", ".5"]) {
      expect(() => parseRupeesToPaise(bad)).toThrow();
    }
  });
});

describe("formatPaise", () => {
  it("formats with Indian grouping", () => {
    expect(formatPaise(12345600)).toContain("1,23,456.00");
    expect(formatPaise(5)).toContain("0.05");
  });
  it("rejects non-integers", () => {
    expect(() => formatPaise(1.5)).toThrow();
  });
});
