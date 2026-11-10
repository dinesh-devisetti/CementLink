import { describe, expect, it } from "vitest";
import { decideApi, decidePage } from "@/server/auth/decide";
import { originAllowed } from "@/server/auth/origin";

const a = (role: "CUSTOMER" | "ADMIN" | "DISTRIBUTOR", status: "ACTIVE" | "PENDING" | "REJECTED" = "ACTIVE") => ({
  id: "u1",
  role,
  status,
});

describe("decideApi", () => {
  it("401 without session", () => {
    expect(decideApi(null, ["ADMIN"])).toEqual({ ok: false, httpStatus: 401, code: "UNAUTHENTICATED" });
  });
  it("403 PENDING when not ACTIVE", () => {
    expect(decideApi(a("DISTRIBUTOR", "PENDING"), ["DISTRIBUTOR"])).toMatchObject({ httpStatus: 403, code: "PENDING" });
    expect(decideApi(a("DISTRIBUTOR", "REJECTED"), ["DISTRIBUTOR"])).toMatchObject({ code: "PENDING" });
  });
  it("403 FORBIDDEN for wrong role", () => {
    expect(decideApi(a("CUSTOMER"), ["ADMIN"])).toMatchObject({ httpStatus: 403, code: "FORBIDDEN" });
  });
  it("ok for matching role", () => {
    expect(decideApi(a("ADMIN"), ["ADMIN", "CUSTOMER"])).toEqual({ ok: true });
  });
});

describe("decidePage", () => {
  it("redirects to login, pending, or own dashboard", () => {
    expect(decidePage(null, ["ADMIN"])).toEqual({ ok: false, redirectTo: "/login" });
    expect(decidePage(a("DISTRIBUTOR", "PENDING"), ["DISTRIBUTOR"])).toEqual({ ok: false, redirectTo: "/pending" });
    expect(decidePage(a("CUSTOMER"), ["ADMIN"])).toEqual({ ok: false, redirectTo: "/customer" });
    expect(decidePage(a("ADMIN"), ["ADMIN"])).toEqual({ ok: true });
  });
});

describe("originAllowed", () => {
  it("requires matching origin", () => {
    expect(originAllowed("http://localhost:3000", "http://localhost:3000")).toBe(true);
    expect(originAllowed("http://evil.com", "http://localhost:3000")).toBe(false);
    expect(originAllowed(null, "http://localhost:3000")).toBe(false);
    expect(originAllowed("not a url", "http://localhost:3000")).toBe(false);
  });
});
