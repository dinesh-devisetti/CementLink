import { describe, expect, it } from "vitest";
import { pageParam } from "@/lib/page-param";

describe("pageParam", () => {
  it.each([[undefined, 1], ["", 1], ["abc", 1], ["0", 1], ["-3", 1], ["1.5", 1], ["2", 2], ["1000", 1000], ["1001", 1]])("%s -> %s", (raw, want) => {
    expect(pageParam(raw as string | undefined)).toBe(want);
  });
});
