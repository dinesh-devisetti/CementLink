import { NextResponse } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const requireRole = vi.fn();
const checkOrigin = vi.fn();
vi.mock("../../src/server/auth/guards", async (orig) => ({ ...(await orig<object>()), checkOrigin: (...a: unknown[]) => checkOrigin(...a), requireRole: (...a: unknown[]) => requireRole(...a) }));

import { withAuth } from "../../src/server/auth/with-auth";

describe("withAuth Cache-Control", () => {
  beforeEach(() => {
    requireRole.mockReset();
    checkOrigin.mockReset();
    checkOrigin.mockResolvedValue(null);
  });
  afterEach(() => vi.restoreAllMocks());
  it("sets no-store on origin rejection", async () => {
    checkOrigin.mockResolvedValue(NextResponse.json({ success: false }, { status: 403 }));
    const res = await withAuth(["ADMIN"], async () => NextResponse.json({}))(new Request("http://x/api", { method: "POST" }), { params: Promise.resolve({}) });
    expect(res.status).toBe(403);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
  it("sets no-store on success", async () => {
    requireRole.mockResolvedValue({ actor: { id: "u" } });
    const res = await withAuth(["ADMIN"], async () => NextResponse.json({ ok: 1 }))(new Request("http://x/api"), { params: Promise.resolve({}) });
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
  it("sets no-store on 401/403 guard responses", async () => {
    requireRole.mockResolvedValue({ response: NextResponse.json({ success: false }, { status: 401 }) });
    const res = await withAuth(["ADMIN"], async () => NextResponse.json({}))(new Request("http://x/api"), { params: Promise.resolve({}) });
    expect(res.status).toBe(401);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
  it("sets no-store on handler errors", async () => {
    requireRole.mockResolvedValue({ actor: { id: "u" } });
    vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await withAuth(["ADMIN"], async () => { throw new Error("boom"); })(new Request("http://x/api"), { params: Promise.resolve({}) });
    expect(res.status).toBe(500);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
  });
});
