import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { activeLink, liveItem } from "@/server/db/fragments";
import * as schema from "@/server/db/schema";
import { makeTestDb } from "./helpers";

let ctx: Awaited<ReturnType<typeof makeTestDb>>;
const ids = { prov: "u-prov", dist: "u-dist", prov2: "u-prov2", dist2: "u-dist2" };
beforeAll(async () => {
  ctx = await makeTestDb();
  const now = Date.now();
  const mk = (id: string, role: "PROVIDER" | "DISTRIBUTOR") =>
    ctx.db.insert(schema.users).values({ id, name: id, email: `${id}@x.com`, passwordHash: "x", role, status: "ACTIVE", phone: "9876543210", createdAt: now, updatedAt: now } as never);
  for (const [id, role] of [[ids.prov, "PROVIDER"], [ids.dist, "DISTRIBUTOR"], [ids.prov2, "PROVIDER"], [ids.dist2, "DISTRIBUTOR"]] as const) await mk(id, role);
  const link = (id: string, upper: string, lower: string, status: "ACTIVE" | "REVOKED") =>
    ctx.db.insert(schema.links).values({ id, kind: "PROVIDER_DISTRIBUTOR", upperId: upper, lowerId: lower, status, requestedBy: lower, revokedBy: status === "REVOKED" ? lower : null, createdAt: now, updatedAt: now });
  await link("l-revoked", ids.prov, ids.dist, "REVOKED");
  await link("l-active", ids.prov2, ids.dist2, "ACTIVE");
});
afterAll(() => ctx.cleanup());

describe("activeLink alias hygiene", () => {
  it("outer `links l` references are not captured by the fragment's own aliases", async () => {
    const rows = await ctx.db.all<{ id: string }>(
      sql`SELECT l.id FROM links l WHERE ${activeLink(sql`l.upper_id`, sql`l.lower_id`, "PROVIDER_DISTRIBUTOR")} ORDER BY l.id`,
    );
    // Only the genuinely ACTIVE link matches; the revoked one must not be dragged in by another active link elsewhere.
    expect(rows.map((r) => r.id)).toEqual(["l-active"]);
  });

  it("outer `users u` references are not captured either", async () => {
    const rows = await ctx.db.all<{ id: string }>(
      sql`SELECT u.id FROM users u WHERE u.role = 'PROVIDER' AND ${activeLink(sql`u.id`, ids.dist, "PROVIDER_DISTRIBUTOR")}`,
    );
    expect(rows).toEqual([]);
    const ok = await ctx.db.all<{ id: string }>(
      sql`SELECT u.id FROM users u WHERE u.role = 'PROVIDER' AND ${activeLink(sql`u.id`, ids.dist2, "PROVIDER_DISTRIBUTOR")}`,
    );
    expect(ok.map((r) => r.id)).toEqual([ids.prov2]);
  });

  it("liveItem is not captured when the item alias is p", async () => {
    const now = Date.now();
    await ctx.db.run(sql`INSERT INTO purchase_orders (id, distributor_id, provider_id, status, version, qty_kg, created_at, updated_at) VALUES ('po-d', ${ids.dist}, ${ids.prov}, 'DRAFT', 0, NULL, ${now}, ${now}), ('po-r', ${ids.dist}, ${ids.prov}, 'REJECTED', 0, 1000, ${now}, ${now})`);
    await ctx.db.run(sql`INSERT INTO orders (id, customer_id, distributor_id, qty_kg, needed_by, address, city, pincode, status, created_at, updated_at)
      VALUES ('o1', ${ids.dist2}, ${ids.dist}, 2000, '2030-01-01', 'a', 'c', '411001', 'UNDER_REVIEW', ${now}, ${now})`);
    await ctx.db.run(sql`INSERT INTO po_items (id, po_id, order_id, distributor_id, qty_kg, created_at) VALUES ('it-d', 'po-d', 'o1', ${ids.dist}, 1000, ${now}), ('it-r', 'po-r', 'o1', ${ids.dist}, 1000, ${now})`);
    // The item alias is `p`, the name the old fragment used for its inner purchase_orders alias.
    const rows = await ctx.db.all<{ n: number }>(sql`SELECT count(*) AS n FROM po_items p WHERE ${liveItem("p")}`);
    expect(Number(rows[0].n)).toBe(1);
  });
});
