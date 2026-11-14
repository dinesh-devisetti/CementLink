import { describe, expect, it } from "vitest";
import { dispatchSchema, rejectPoSchema } from "@/lib/validation/po-lifecycle";

describe("dispatchSchema", () => {
  it("accepts a date only and normalizes optional fields to null", () => {
    expect(dispatchSchema.parse({ dispatchDate: "2026-11-14" })).toEqual({ dispatchDate: "2026-11-14", vehicleNo: null, driverPhone: null });
  });
  it("upper-cases the vehicle number and strips spaces and hyphens", () => {
    expect(dispatchSchema.parse({ dispatchDate: "2026-11-14", vehicleNo: " ts 09-ab 1234 ", driverPhone: "9876543210" })).toEqual({
      dispatchDate: "2026-11-14", vehicleNo: "TS09AB1234", driverPhone: "9876543210",
    });
  });
  it("treats blank optional fields as absent", () => {
    expect(dispatchSchema.parse({ dispatchDate: "2026-11-14", vehicleNo: "  ", driverPhone: "" })).toMatchObject({ vehicleNo: null, driverPhone: null });
  });
  it.each([
    [{ dispatchDate: "2026-02-30" }],
    [{ dispatchDate: "2026-13-40" }],
    [{ dispatchDate: "14-11-2026" }],
    [{ dispatchDate: "" }],
    [{}],
    [{ dispatchDate: "2026-11-14", vehicleNo: "AB1" }],
    [{ dispatchDate: "2026-11-14", vehicleNo: "AB12$%34" }],
    [{ dispatchDate: "2026-11-14", driverPhone: "1234567890" }],
    [{ dispatchDate: "2026-11-14", driverPhone: "98765" }],
    [{ dispatchDate: "2026-11-14", extra: 1 }],
  ])("rejects %j", (body) => {
    expect(dispatchSchema.safeParse(body).success).toBe(false);
  });
});

describe("rejectPoSchema", () => {
  it("requires a trimmed reason of at most 300 chars and no unknown keys", () => {
    expect(rejectPoSchema.parse({ reason: "  Out of stock " })).toEqual({ reason: "Out of stock" });
    expect(rejectPoSchema.safeParse({ reason: "  " }).success).toBe(false);
    expect(rejectPoSchema.safeParse({ reason: "x".repeat(301) }).success).toBe(false);
    expect(rejectPoSchema.safeParse({ reason: "ok", x: 1 }).success).toBe(false);
  });
});
