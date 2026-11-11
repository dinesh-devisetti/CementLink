import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { amountPaise } from "@/server/domain/amounts";
import { assertSql, guardedBatch, isAssertFailure } from "@/server/db/guard";
import { activeLink } from "@/server/db/fragments";
import { users } from "@/server/db/schema";
import { makeTestDb } from "./helpers";

let h: Awaited<ReturnType<typeof makeTestDb>>;
beforeAll(async () => {
  h = await makeTestDb();
});
afterAll(() => h.cleanup());

const count = async () => Number((await h.db.all<{ n: number }>(sql`SELECT count(*) AS n FROM users`))[0].n);
const ins = (id: string) =>
  h.db.insert(users).values({ id, email: `${id}@x.com`, passwordHash: "x", role: "CUSTOMER", status: "ACTIVE", name: id, createdAt: 1 });

describe("guard_assert", () => {
  it("passes: writes between asserts commit", async () => {
    const before = await count();
    await guardedBatch(h.db, [assertSql(sql`1 = 1`), ins("g-pass"), assertSql(sql`(SELECT count(*) FROM users) = ${before + 1}`)]);
    expect(await count()).toBe(before + 1);
  });

  it("aborts on a failing pre-condition, writes never happen", async () => {
    const before = await count();
    const err = await guardedBatch(h.db, [assertSql(sql`1 = 0`), ins("g-abort")]).catch((e) => e);
    expect(isAssertFailure(err)).toBe(true);
    expect(await count()).toBe(before);
  });

  it("rolls back earlier writes when a post-condition fails", async () => {
    const before = await count();
    const err = await guardedBatch(h.db, [
      assertSql(sql`1 = 1`),
      ins("g-rb1"),
      ins("g-rb2"),
      assertSql(sql`(SELECT count(*) FROM users) = ${before}`),
    ]).catch((e) => e);
    expect(isAssertFailure(err)).toBe(true);
    expect(await count()).toBe(before);
  });

  it("a NULL condition (empty subquery) fails closed", async () => {
    const err = await guardedBatch(h.db, [assertSql(sql`(SELECT 1 FROM users WHERE id = 'nope')`)]).catch((e) => e);
    expect(isAssertFailure(err)).toBe(true);
  });

  it("does not treat other errors as assert failures", async () => {
    const err = await guardedBatch(h.db, [ins("g-dup"), ins("g-dup")]).catch((e) => e);
    expect(err).toBeInstanceOf(Error);
    expect(isAssertFailure(err)).toBe(false);
  });

  it("activeLink fragment is false with no link", async () => {
    const r = await h.db.all<{ v: number }>(sql`SELECT (${activeLink("a", "b")}) AS v`);
    expect(Number(r[0].v)).toBe(0);
  });
});

describe("SQL amount CHECK matches domain/amounts", () => {
  it("accepts the domain value and rejects off-by-one", async () => {
    const now = 1;
    await ins("amt-p");
    await ins("amt-d");
    await h.db.run(sql`INSERT INTO purchase_orders (id, distributor_id, provider_id, status, version, qty_kg, rate_per_tonne_paise, total_paise, created_at, updated_at)
      VALUES ('po1', 'amt-d', 'amt-p', 'PLACED', 0, 500, 1500, ${amountPaise(500, 1500)}, ${now}, ${now})`);
    await expect(
      h.db.run(sql`INSERT INTO purchase_orders (id, distributor_id, provider_id, status, version, qty_kg, rate_per_tonne_paise, total_paise, created_at, updated_at)
        VALUES ('po2', 'amt-d', 'amt-p', 'PLACED', 0, 500, 1500, ${amountPaise(500, 1500) + 1}, ${now}, ${now})`),
    ).rejects.toThrow();
  });
});
