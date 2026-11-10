import { describe, expect, it } from "vitest";
import { createRequestSchema } from "@/lib/validation/requests";
import { resolveTotalBags, todayIst } from "@/lib/qty-input";

const NOW = new Date("2026-11-03T10:00:00Z"); // 15:30 IST, 03 Nov
const base = {
  unit: "BAGS",
  quantity: "50",
  address: "12 MG Road",
  city: "Pune",
  pincode: "411001",
  neededBy: "2026-11-10",
  allocations: [
    { distributorId: "d1", bags: 30 },
    { distributorId: "d2", bags: 20 },
  ],
};
const parse = (o: object) => createRequestSchema(NOW).safeParse({ ...base, ...o });
const err = (o: object) => {
  const r = parse(o);
  return r.success ? null : r.error.issues.map((i) => `${i.path.join(".")}:${i.message}`).join("|");
};

describe("todayIst", () => {
  it("uses India date, not UTC", () => {
    expect(todayIst(new Date("2026-11-03T20:00:00Z"))).toBe("2026-11-04");
    expect(todayIst(NOW)).toBe("2026-11-03");
  });
});

describe("resolveTotalBags", () => {
  it("bags pass through, tonnes convert at 20/t", () => {
    expect(resolveTotalBags("BAGS", "50")).toBe(50);
    expect(resolveTotalBags("TONNES", "2.5")).toBe(50);
    expect(resolveTotalBags("TONNES", "0.05")).toBe(1);
  });
  it("rejects fractions of a bag", () => {
    expect(() => resolveTotalBags("TONNES", "0.03")).toThrow();
    expect(() => resolveTotalBags("BAGS", "2.5")).toThrow();
    expect(() => resolveTotalBags("BAGS", "0")).toThrow();
    expect(() => resolveTotalBags("BAGS", "-4")).toThrow();
    expect(() => resolveTotalBags("BAGS", "abc")).toThrow();
  });
});

describe("createRequestSchema", () => {
  it("accepts a valid split and returns totalBags", () => {
    const r = parse({});
    expect(r.success && r.data.totalBags).toBe(50);
  });
  it("converts tonnes", () => {
    const r = parse({ unit: "TONNES", quantity: "1.5", allocations: [{ distributorId: "d1", bags: 30 }] });
    expect(r.success && r.data.totalBags).toBe(30);
  });
  it("whole bags error for fractional tonnes", () => {
    expect(err({ unit: "TONNES", quantity: "0.03" })).toContain("Must be a whole number of bags");
  });
  it("blocks when allocations do not sum to total", () => {
    expect(err({ allocations: [{ distributorId: "d1", bags: 30 }] })).toContain("allocations");
    expect(err({ allocations: [{ distributorId: "d1", bags: 60 }] })).toContain("allocations");
  });
  it("requires 1+ allocations, positive integers, unique distributors", () => {
    expect(err({ allocations: [] })).toContain("allocations");
    expect(err({ allocations: [{ distributorId: "d1", bags: 0 }, { distributorId: "d2", bags: 50 }] })).toContain("allocations");
    expect(err({ allocations: [{ distributorId: "d1", bags: 2.5 }] })).toContain("allocations");
    expect(err({ allocations: [{ distributorId: "d1", bags: 25 }, { distributorId: "d1", bags: 25 }] })).toContain("Duplicate");
  });
  it("rejects past needed-by, accepts today (IST) and future", () => {
    expect(err({ neededBy: "2026-11-02" })).toContain("Pick today or a later date");
    expect(parse({ neededBy: "2026-11-03" }).success).toBe(true);
    expect(parse({ neededBy: "2027-01-01" }).success).toBe(true);
  });
  it("rejects malformed or impossible dates", () => {
    expect(err({ neededBy: "03/11/2026" })).toContain("neededBy");
    expect(err({ neededBy: "2026-02-31" })).toContain("neededBy");
  });
  it("pincode must be exactly 6 digits", () => {
    for (const p of ["41100", "4110011", "41100a", "４１１００１", " 411001"]) expect(err({ pincode: p })).toContain("pincode");
  });
  it("requires address and city, trims, caps length", () => {
    expect(err({ address: "  " })).toContain("address");
    expect(err({ city: "" })).toContain("city");
    expect(err({ address: "x".repeat(301) })).toContain("address");
  });
  it("caps total bags and allocation count", () => {
    expect(err({ quantity: "100001", allocations: [{ distributorId: "d1", bags: 50000 }, { distributorId: "d2", bags: 50001 }] })).toContain("quantity");
  });
});

describe("createRequestSchema extras (fix loop 1)", () => {
  it("rejects needed-by more than a year ahead", () => {
    expect(err({ neededBy: "2027-11-03" })).toBeNull();
    expect(err({ neededBy: "2027-11-04" })).toContain("neededBy");
  });
  it("rejects control and bidi characters in address and city", () => {
    expect(err({ address: "12 MG\u0000Road" })).toContain("address");
    expect(err({ address: "12 MG\nRoad" })).toContain("address");
    expect(err({ city: "Pu‮ne" })).toContain("city");
    expect(err({ address: "12 MG Road, Block-4/B" })).toBeNull();
  });
});
