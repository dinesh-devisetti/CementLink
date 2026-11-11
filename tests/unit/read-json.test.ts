import { describe, expect, it } from "vitest";
import { MAX_JSON_BYTES, readJson } from "@/server/auth/http";
import { AppError } from "@/server/errors";

const post = (body: string, headers: Record<string, string> = {}) =>
  new Request("http://localhost/x", { method: "POST", body, headers });

describe("readJson", () => {
  it("parses a small body", async () => {
    expect(await readJson(post('{"a":1}'))).toEqual({ a: 1 });
  });

  it("rejects an oversize declared Content-Length with 413 before reading", async () => {
    const err = await readJson(post("{}", { "content-length": String(MAX_JSON_BYTES + 1) })).catch((e) => e);
    expect(err).toBeInstanceOf(AppError);
    expect(err).toMatchObject({ code: "PAYLOAD_TOO_LARGE", httpStatus: 413 });
  });

  it("rejects an oversize actual body with 413", async () => {
    const big = JSON.stringify({ pad: "x".repeat(MAX_JSON_BYTES) });
    const err = await readJson(post(big)).catch((e) => e);
    expect(err).toMatchObject({ code: "PAYLOAD_TOO_LARGE", httpStatus: 413 });
  });

  it("honours a custom limit and reports bad JSON as 400", async () => {
    await expect(readJson(post("123456"), 5)).rejects.toMatchObject({ httpStatus: 413 });
    await expect(readJson(post("nope"))).rejects.toMatchObject({ code: "BAD_JSON", httpStatus: 400 });
  });
});
