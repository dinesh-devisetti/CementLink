import { afterAll, describe, expect, it } from "vitest";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { migrate } from "drizzle-orm/libsql/migrator";
import { createInvoiceSchema } from "@/lib/validation/invoices";

const dir = mkdtempSync(path.join(tmpdir(), "cl-qa6-"));
afterAll(() => rmSync(dir, { recursive: true, force: true }));
const full = path.resolve(import.meta.dirname, "../../drizzle");

function oldFolder() {
  const old = path.join(dir, "old");
  cpSync(full, old, { recursive: true });
  const jp = path.join(old, "meta/_journal.json");
  const j = JSON.parse(readFileSync(jp, "utf8"));
  j.entries = j.entries.filter((e: { tag: string }) => !e.tag.startsWith("0004"));
  writeFileSync(jp, JSON.stringify(j));
  return old;
}

async function seedLegacy(file: string, badTotal: boolean) {
  const client = createClient({ url: `file:${file}` });
  const db = drizzle(client);
  await migrate(db, { migrationsFolder: oldFolder() });
  const now = Date.now();
  for (const [id, role] of [["d", "DISTRIBUTOR"], ["p", "PROVIDER"]]) {
    await client.execute({
      sql: "insert into users (id,name,email,password_hash,role,status,created_at) values (?,?,?,?,?,'ACTIVE',?)",
      args: [id, id, `${id}@x.com`, "h", role, now],
    });
  }
  await client.execute({
    sql: "insert into purchase_orders (id,distributor_id,provider_id,qty_bags,rate_per_bag_paise,total_paise,status,created_at) values ('po1','d','p',100,10000,?,'CONFIRMED',?)",
    args: [badTotal ? 5 : 1000000, now],
  });
  return { client, db };
}

describe("migration 0004 on existing data", () => {
  it("keeps legacy POs, adds invoices table and enforces constraints afterwards", async () => {
    const { client, db } = await seedLegacy(path.join(dir, "ok.db"), false);
    await migrate(db, { migrationsFolder: full });
    const po = await client.execute("select id,qty_bags,total_paise,status from purchase_orders");
    expect(po.rows).toHaveLength(1);
    expect(Number(po.rows[0].total_paise)).toBe(1000000);
    const idx = await client.execute("select name from sqlite_master where type='index' and tbl_name='purchase_orders'");
    expect(idx.rows.map((r) => r.name)).toEqual(expect.arrayContaining(["po_provider_idx", "po_distributor_idx"]));
    await client.execute({
      sql: "insert into invoices values ('i1','po1','p','d','INV-1','2026-01-01',10,10000,100000,?)",
      args: [Date.now()],
    });
    await expect(
      client.execute({ sql: "insert into invoices values ('i2','po1','p','d','INV-1','2026-01-01',10,10000,100000,?)", args: [Date.now()] }),
    ).rejects.toThrow();
    await expect(
      client.execute({ sql: "insert into purchase_orders values ('po2','d','p',10,100,1,'PLACED',?)", args: [Date.now()] }),
    ).rejects.toThrow();
    const fk = await client.execute("pragma foreign_key_check");
    expect(fk.rows).toHaveLength(0);
  });

  it("fails loudly (no silent data loss) when a legacy PO has an inconsistent total", async () => {
    const { client, db } = await seedLegacy(path.join(dir, "bad.db"), true);
    await expect(migrate(db, { migrationsFolder: full })).rejects.toThrow();
    const po = await client.execute("select id from purchase_orders");
    expect(po.rows).toHaveLength(1);
  });
});

describe("invoice validation edges", () => {
  const base = { invoiceNo: "a-1", invoiceDate: "2026-01-01", qtyBags: 1, ratePerBag: "10" };
  it("rejects tomorrow (IST) and accepts today (IST)", () => {
    const now = new Date("2026-06-10T20:00:00Z"); // 01:30 IST on the 11th
    expect(createInvoiceSchema(now).safeParse({ ...base, invoiceDate: "2026-06-11" }).success).toBe(true);
    expect(createInvoiceSchema(now).safeParse({ ...base, invoiceDate: "2026-06-12" }).success).toBe(false);
  });
  it("rejects zero/negative/fractional qty, zero rate, 41-char number, impossible date, whitespace-only number", () => {
    const s = createInvoiceSchema(new Date("2026-06-10T00:00:00Z"));
    for (const bad of [
      { qtyBags: 0 }, { qtyBags: -1 }, { qtyBags: 1.5 }, { ratePerBag: "0" }, { ratePerBag: "-5" }, { ratePerBag: "abc" },
      { invoiceNo: "A".repeat(41) }, { invoiceNo: "   " }, { invoiceNo: "<script>" }, { invoiceDate: "2026-02-30" },
    ]) expect(s.safeParse({ ...base, ...bad }).success, JSON.stringify(bad)).toBe(false);
    expect(s.safeParse({ ...base, invoiceNo: "  inv-9  " })).toMatchObject({ success: true, data: { invoiceNo: "INV-9" } });
  });
});

describe("V6 fix round 1: money cap races and rule precedence", () => {
  it("concurrent invoices never exceed the PO total; IST same-day accepted; qty error wins over money error", async () => {
    const file = path.join(dir, "race.db");
    const client = createClient({ url: `file:${file}` });
    const db = drizzle(client);
    await migrate(db, { migrationsFolder: full });
    const now = Date.UTC(2026, 5, 10, 20, 0); // 11 Jun 01:30 IST
    for (const [id, role] of [["d", "DISTRIBUTOR"], ["p", "PROVIDER"]]) {
      await client.execute({
        sql: "insert into users (id,name,email,password_hash,role,status,created_at) values (?,?,?,?,?,'ACTIVE',?)",
        args: [id, id, `${id}@x.com`, "h", role, now],
      });
    }
    await client.execute({
      sql: "insert into purchase_orders values ('po','d','p',100,10000,1000000,'CONFIRMED',?)",
      args: [now],
    });
    const { createInvoice } = await import("@/server/services/invoices");
    const dbx = db as unknown as Parameters<typeof createInvoice>[0];
    const results = await Promise.allSettled(
      Array.from({ length: 6 }, (_, i) => createInvoice(dbx, "p", "po", { invoiceNo: `R-${i}`, invoiceDate: "2026-06-11", qtyBags: 20, ratePerBagPaise: 10000 }, now)),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    const rejected = results.filter((r) => r.status === "rejected") as PromiseRejectedResult[];
    expect(rejected[0].reason.code).toBe("QTY_EXCEEDS_PO");
    const sum = await client.execute("select sum(amount_paise) s from invoices");
    expect(Number(sum.rows[0].s)).toBeLessThanOrEqual(1000000);
    await expect(
      createInvoice(dbx, "p", "po", { invoiceNo: "X", invoiceDate: "2026-06-10", qtyBags: 1, ratePerBagPaise: 1 }, now),
    ).rejects.toMatchObject({ code: "DATE_BEFORE_PO" });
  });
});
