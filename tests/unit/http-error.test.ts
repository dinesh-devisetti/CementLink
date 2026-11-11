import { describe, expect, it, vi } from "vitest";
vi.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined }) }));
import { handleError } from "@/server/auth/http";
import { AppError } from "@/server/errors";

describe("handleError", () => {
  it("returns fields and Retry-After together on one response", async () => {
    const res = handleError(new AppError("X", "bad", 429, 7, { qtyBags: "nope" }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("7");
    expect(await res.json()).toMatchObject({ code: "X", fields: { qtyBags: "nope" } });
  });
  it("omits fields when none given", async () => {
    const res = handleError(new AppError("Y", "m", 409));
    expect(res.headers.get("retry-after")).toBeNull();
    expect((await res.json()).fields).toBeUndefined();
  });
});
