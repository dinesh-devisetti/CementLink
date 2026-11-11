import { describe, expect, it } from "vitest";
import { linkStatusLabel } from "@/lib/link-label";

describe("linkStatusLabel", () => {
  it("Cancelled for a REVOKED link nobody revoked (revoked_by NULL)", () => {
    expect(linkStatusLabel("REVOKED", null)).toBe("Cancelled");
  });
  it("Revoked when someone revoked it, or when unknown", () => {
    expect(linkStatusLabel("REVOKED", "u1")).toBe("Revoked");
    expect(linkStatusLabel("REVOKED")).toBe("Revoked");
  });
  it("other statuses are unchanged", () => {
    expect(linkStatusLabel("ACTIVE", null)).toBe("Active");
    expect(linkStatusLabel("REJECTED", null)).toBe("Rejected");
    expect(linkStatusLabel("PENDING", null)).toBe("Pending");
  });
});
