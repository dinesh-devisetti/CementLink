import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/libsql/migrator";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb } from "@/server/db/client";
import { runSeed } from "../../scripts/seed";
import { makeTestDb } from "./helpers";

let h: Awaited<ReturnType<typeof makeTestDb>>;
beforeAll(async () => {
  h = await makeTestDb();
  await h.db.run(sql`INSERT INTO users (id,email,password_hash,role,status,name,created_at) VALUES ('u1','a@x.com','x','CUSTOMER','ACTIVE','a',1),('u2','b@x.com','x','DISTRIBUTOR','ACTIVE','b',1),('u3','c@x.com','x','PROVIDER','ACTIVE','c',1)`);
});
afterAll(() => h.cleanup());

const fails = async (q: ReturnType<typeof sql>) => {
  try {
    await h.db.run(q);
    return false;
  } catch {
    return true;
  }
};

describe("QA V10 schema", () => {
  it("has every v2 table and no v1 table", async () => {
    const t = (await h.db.all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type='table'`)).map((r) => r.name);
    for (const n of ["links", "orders", "order_allocations", "purchase_orders", "po_items", "dispatches", "provider_invoices", "provider_payments", "customer_invoices", "payments", "webhook_events"]) expect(t).toContain(n);
    for (const n of ["requests", "request_lines", "invoices"]) expect(t).not.toContain(n);
  });

  it("order CHECKs: qty 0, 1000001 kg, bad pincode, bad status", async () => {
    const o = (id: string, qty: number, pin = "500001", st = "REQUESTED") =>
      sql`INSERT INTO orders (id,customer_id,distributor_id,qty_kg,address,city,pincode,needed_by,status,created_at,updated_at) VALUES (${id},'u1','u2',${qty},'a','c',${pin},'2030-01-01',${st},1,1)`;
    expect(await fails(o("o0", 0))).toBe(true);
    expect(await fails(o("o1", 1_000_001))).toBe(true);
    expect(await fails(o("o2", 5, "12345"))).toBe(true);
    expect(await fails(o("o3", 5, "12345a"))).toBe(true);
    expect(await fails(o("o4", 5, "500001", "BOGUS"))).toBe(true);
    expect(await fails(o("ok1", 1))).toBe(false);
    expect(await fails(o("ok2", 1_000_000))).toBe(false);
  });

  it("PO CHECKs: placed needs provider+qty, total formula, rate bounds", async () => {
    const p = (id: string, prov: string | null, st: string, qty: number | null, rate: number | null, total: number | null) =>
      sql`INSERT INTO purchase_orders (id,distributor_id,provider_id,status,qty_kg,rate_per_tonne_paise,total_paise,created_at,updated_at) VALUES (${id},'u2',${prov},${st},${qty},${rate},${total},1,1)`;
    expect(await fails(p("p1", null, "PLACED", 1000, 100, 100))).toBe(true);
    expect(await fails(p("p2", "u3", "PLACED", null, null, null))).toBe(true);
    expect(await fails(p("p3", "u3", "PLACED", 1000, 100, 99))).toBe(true); // wrong total
    expect(await fails(p("p4", "u3", "PLACED", 1000, 0, 0))).toBe(true);
    expect(await fails(p("p5", "u3", "PLACED", 1000, 10_000_001, 10_000_001))).toBe(true);
    expect(await fails(p("p6", "u3", "PLACED", 1, 500, 1))).toBe(false); // 0.5 -> 1
    expect(await fails(p("p7", null, "DRAFT", null, null, null))).toBe(false);
    expect(await fails(p("p8", null, "DRAFT", null, 100, 5))).toBe(true); // total w/o qty must be NULL
  });

  it("links: distinct ends, unique pair, kind/status enums", async () => {
    const l = (id: string, up: string, lo: string, kind = "PROVIDER_DISTRIBUTOR", st = "PENDING") =>
      sql`INSERT INTO links (id,kind,upper_id,lower_id,status,requested_by,created_at,updated_at) VALUES (${id},${kind},${up},${lo},${st},'u2',1,1)`;
    expect(await fails(l("l1", "u3", "u3"))).toBe(true);
    expect(await fails(l("l2", "u3", "u2", "X"))).toBe(true);
    expect(await fails(l("l3", "u3", "u2", "PROVIDER_DISTRIBUTOR", "X"))).toBe(true);
    expect(await fails(l("l4", "u3", "u2"))).toBe(false);
    expect(await fails(l("l5", "u3", "u2"))).toBe(true);
  });

  it("payments partial uniques: one PAID, one CREATED per invoice; multiple FAILED ok", async () => {
    await h.db.run(sql`INSERT INTO customer_invoices (id,order_id,distributor_id,customer_id,invoice_no,invoice_date,qty_kg,rate_per_tonne_paise,amount_paise,created_at) VALUES ('ci1','ok1','u2','u1','I1','2030-01-01',1000,100,100,1)`);
    const pay = (id: string, st: string) =>
      sql`INSERT INTO payments (id,customer_invoice_id,customer_id,distributor_id,amount_paise,status,created_at,updated_at) VALUES (${id},'ci1','u1','u2',100,${st},1,1)`;
    const r = await h.db.all<{ sql: string }>(sql`SELECT sql FROM sqlite_master WHERE name='payments'`);
    expect(r[0].sql).toContain("customer_invoice_id");
    let err: unknown;
    try { await h.db.run(pay("pa1", "CREATED")); } catch (e) { err = e; }
    if (err) throw new Error("payments insert failed (column mismatch?): " + String(err));
    expect(await fails(pay("pa2", "CREATED"))).toBe(true);
    expect(await fails(pay("pa3", "FAILED"))).toBe(false);
    expect(await fails(pay("pa4", "FAILED"))).toBe(false);
    expect(await fails(pay("pa5", "PAID"))).toBe(false);
    expect(await fails(pay("pa6", "PAID"))).toBe(true);
  });

  it("invoice amount CHECK enforces formula", async () => {
    const inv = (id: string, no: string, amt: number) =>
      sql`INSERT INTO customer_invoices (id,order_id,distributor_id,customer_id,invoice_no,invoice_date,qty_kg,rate_per_tonne_paise,amount_paise,created_at) VALUES (${id},'ok2','u2','u1',${no},'2030-01-01',1,500,${amt},1)`;
    expect(await fails(inv("x1", "A", 0))).toBe(true);
    expect(await fails(inv("x2", "B", 1))).toBe(false);
  });

  it("po_items: unique (po,order) and seed_key", async () => {
    const it2 = (id: string, po: string, ord: string, key: string | null) =>
      sql`INSERT INTO po_items (id,po_id,order_id,distributor_id,qty_kg,seed_key,created_at) VALUES (${id},${po},${ord},'u2',10,${key},1)`;
    expect(await fails(it2("i1", "p7", "ok1", "k1"))).toBe(false);
    expect(await fails(it2("i2", "p7", "ok1", "k2"))).toBe(true);
    expect(await fails(it2("i3", "p6", "ok1", "k1"))).toBe(true);
    expect(await fails(it2("i4", "p6", "ok1", null))).toBe(false);
    expect(await fails(it2("i5", "p6", "ok2", null))).toBe(false);
  });
});

describe("QA V10 upgrade path v1 -> v2 with data", () => {
  it("applies 0005/0006 over a populated v1 database", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cl-qa-up-"));
    try {
      const src = path.resolve(import.meta.dirname, "../../drizzle");
      const v1 = path.join(dir, "v1");
      cpSync(src, v1, { recursive: true });
      const jp = path.join(v1, "meta/_journal.json");
      const j = JSON.parse(readFileSync(jp, "utf8"));
      j.entries = j.entries.filter((e: { idx: number }) => e.idx <= 4);
      writeFileSync(jp, JSON.stringify(j));
      const db = createDb(`file:${path.join(dir, "u.db")}`);
      await migrate(db, { migrationsFolder: v1 });
      await db.run(sql`INSERT INTO users (id,email,password_hash,role,status,name,created_at) VALUES ('c','c@x.com','x','CUSTOMER','ACTIVE','c',1),('d','d@x.com','x','DISTRIBUTOR','ACTIVE','d',1),('p','p@x.com','x','PROVIDER','ACTIVE','p',1)`);
      await db.run(sql`INSERT INTO requests (id,customer_id,total_bags,address,city,pincode,needed_by,created_at) VALUES ('r','c',20,'a','c','500001','2030-01-01',1)`);
      await db.run(sql`INSERT INTO request_lines (id,request_id,distributor_id,qty_bags,status) VALUES ('rl','r','d',20,'SENT')`);
      await db.run(sql`INSERT INTO purchase_orders (id,distributor_id,provider_id,qty_bags,rate_per_bag_paise,total_paise,created_at) VALUES ('po','d','p',20,100,2000,1)`);
      await db.run(sql`INSERT INTO invoices (id,po_id,provider_id,distributor_id,invoice_no,invoice_date,qty_bags,rate_per_bag_paise,amount_paise,created_at) VALUES ('i','po','p','d','N','2030-01-01',20,100,2000,1)`);
      await migrate(db, { migrationsFolder: src });
      const t = (await db.all<{ name: string }>(sql`SELECT name FROM sqlite_master WHERE type IN ('table','view')`)).map((r) => r.name);
      expect(t).toContain("guard_assert");
      expect(t).toContain("links");
      expect(t).not.toContain("request_lines");
      const fk = await db.all(sql`PRAGMA foreign_key_check`);
      expect(fk).toEqual([]);
      const users = await db.all<{ n: number }>(sql`SELECT count(*) n FROM users`);
      expect(Number(users[0].n)).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("seed is idempotent and gives 5 ACTIVE users, 3 ACTIVE links", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cl-qa-seed-"));
    try {
      const url = `file:${path.join(dir, "s.db")}`;
      await migrate(createDb(url), { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
      await runSeed(url, undefined, "admin@example.com", "AdminPass123!", "DemoPass123!");
      await runSeed(url, undefined, "admin@example.com", "AdminPass123!", "DemoPass123!");
      const db = createDb(url);
      expect(Number((await db.all<{ n: number }>(sql`SELECT count(*) n FROM users WHERE status='ACTIVE'`))[0].n)).toBe(5);
      expect(Number((await db.all<{ n: number }>(sql`SELECT count(*) n FROM users`))[0].n)).toBe(5);
      expect(Number((await db.all<{ n: number }>(sql`SELECT count(*) n FROM links WHERE status='ACTIVE'`))[0].n)).toBe(3);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
