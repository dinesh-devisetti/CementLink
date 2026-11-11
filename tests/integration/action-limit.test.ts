import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { handleError } from "@/server/auth/http";
import { enforceActionLimit } from "@/server/auth/action-limit";
import { makeTestDb } from "./helpers";

vi.mock("@/server/config", () => ({ getConfig: () => ({ ACTION_MAX_PER_MIN: 3 }) }));

let h: Awaited<ReturnType<typeof makeTestDb>>;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(() => h.cleanup());

describe("enforceActionLimit", () => {
  it("allows ACTION_MAX_PER_MIN calls then trips with 429 and Retry-After", async () => {
    for (let i = 0; i < 3; i++) await enforceActionLimit(h.db, "order", "u1");
    const err = await enforceActionLimit(h.db, "order", "u1").catch((e) => e);
    expect(err).toMatchObject({ code: "RATE_LIMITED", httpStatus: 429 });
    const res = handleError(err);
    expect(res.status).toBe(429);
    const retry = Number(res.headers.get("Retry-After"));
    expect(retry).toBeGreaterThan(0);
    expect(retry).toBeLessThanOrEqual(60);
  });

  it("buckets are per scope and per actor", async () => {
    await expect(enforceActionLimit(h.db, "order", "u2")).resolves.toBeUndefined();
    await expect(enforceActionLimit(h.db, "link", "u1")).resolves.toBeUndefined();
  });
});
