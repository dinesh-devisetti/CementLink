import { existsSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { demoSeedAllowed } from "../../scripts/env";
import { REPO_ROOT, assertInsideRoot, assertNotProduction, localDbPath, openAndValidate, resetDb } from "../../scripts/reset-db";
import { runSeed, seedDemo } from "../../scripts/seed";
import { createDb } from "@/server/db/client";

describe("reset-db + v2 seed", () => {
  it("refuses remote urls", () => {
    expect(() => localDbPath("libsql://x.turso.io")).toThrow(/local/);
  });

  it("rejects empty paths and file:// with an authority", () => {
    expect(() => localDbPath("file:")).toThrow();
    expect(() => localDbPath("file:?mode=rwc")).toThrow();
    expect(() => localDbPath("file://host/etc/x.db")).toThrow(/host/);
    expect(() => localDbPath("file:dir/")).toThrow();
  });

  it("ignores query strings, decodes paths, accepts file:///abs", () => {
    expect(localDbPath("file:x.db?mode=ro")).toMatch(/\/x\.db$/);
    expect(localDbPath("file:my%20db.db")).toMatch(/\/my db\.db$/);
    expect(localDbPath("file:///tmp/a.db")).toBe("/tmp/a.db");
  });

  it("default root is the repo directory, not the cwd", () => {
    expect(REPO_ROOT).toBe(path.resolve(import.meta.dirname, "../.."));
    expect(() => assertInsideRoot(path.join(REPO_ROOT, "dev.db"), REPO_ROOT)).not.toThrow();
  });

  it("compares realpaths: a symlink inside the root pointing outside is refused", () => {
    const root = mkdtempSync(path.join(tmpdir(), "cl-root-"));
    const outside = mkdtempSync(path.join(tmpdir(), "cl-out-"));
    try {
      symlinkSync(outside, path.join(root, "link"));
      expect(() => assertInsideRoot(path.join(root, "link", "x.db"), root)).toThrow(/inside/);
      expect(() => assertInsideRoot(path.join(root, "ok.db"), root)).not.toThrow();
      // a root given through a symlink still matches files realpath-inside it
      const alias = path.join(outside, "alias");
      symlinkSync(root, alias);
      expect(() => assertInsideRoot(path.join(root, "ok.db"), alias)).not.toThrow();
    } finally {
      rmSync(root, { recursive: true, force: true });
      rmSync(outside, { recursive: true, force: true });
    }
  });

  it("only deletes .db files inside the root directory", async () => {
    expect(() => assertInsideRoot("/repo/tests/e2e.db", "/repo")).not.toThrow();
    expect(() => assertInsideRoot("/etc/x.db", "/repo")).toThrow(/inside/);
    expect(() => assertInsideRoot("/repo/../other/x.db", "/repo")).toThrow(/inside/);
    expect(() => assertInsideRoot("/repo/notes.txt", "/repo")).toThrow(/\.db/);
    expect(() => assertInsideRoot("/repo", "/repo")).toThrow();
    const dir = mkdtempSync(path.join(tmpdir(), "cl-reset-"));
    const file = path.join(dir, "keep.db");
    writeFileSync(file, "keep me");
    try {
      await expect(resetDb(`file:${file}`, "admin@example.com", "AdminPass123!")).rejects.toThrow(/inside/);
      expect(existsSync(file)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses production and Vercel", () => {
    expect(() => assertNotProduction({ NODE_ENV: "production" })).toThrow(/production/);
    expect(() => assertNotProduction({ VERCEL: "1" })).toThrow();
    expect(() => assertNotProduction({ NODE_ENV: "test" })).not.toThrow();
  });

  it("demo seeding gate", () => {
    expect(demoSeedAllowed("file:./x.db", {})).toBe(true);
    expect(demoSeedAllowed("libsql://x.turso.io", {})).toBe(false);
    expect(demoSeedAllowed("libsql://x.turso.io", { SEED_DEMO: "true" })).toBe(false);
    expect(demoSeedAllowed("libsql://x.turso.io", { SEED_DEMO_REMOTE: "true" })).toBe(false);
    expect(demoSeedAllowed("libsql://x.turso.io", { SEED_DEMO: "true", SEED_DEMO_REMOTE: "true" })).toBe(true);
    expect(demoSeedAllowed("libsql://x.turso.io", { SEED_DEMO: "true", SEED_DEMO_REMOTE: "true", VERCEL: "1" })).toBe(false);
    expect(demoSeedAllowed("file:./x.db", { NODE_ENV: "production" })).toBe(false);
  });

  it("refuses a demo password equal to the admin password, before touching any file", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cl-reset-"));
    const file = path.join(dir, "same.db");
    writeFileSync(file, "keep me");
    try {
      await expect(resetDb(`file:${file}`, "admin@example.com", "SamePass123!", "SamePass123!")).rejects.toThrow(/differ/);
      expect(existsSync(file)).toBe(true);
      await expect(runSeed(`file:${file}`, undefined, "admin@example.com", "SamePass123!", "SamePass123!")).rejects.toThrow(/differ/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("opens the libsql client before deleting: an unopenable URL leaves the existing file alone", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cl-reset-"));
    const file = path.join(dir, "keep.db");
    writeFileSync(file, "keep me");
    try {
      await expect(openAndValidate(`file:${path.join(dir, "nope", "x.db")}`)).rejects.toThrow();
      await expect(resetDb(`file:${file}?mode=bogus`, "admin@example.com", "AdminPass123!", undefined, dir)).rejects.toThrow();
      expect(existsSync(file)).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("seeds no demo users without a demo password", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cl-reset-"));
    try {
      await resetDb(`file:${path.join(dir, "n.db")}`, "admin@example.com", "AdminPass123!", undefined, dir);
      const db = createDb(`file:${path.join(dir, "n.db")}`);
      expect(Number((await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM users`))[0].n)).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("wipes, migrates and seeds admin, demo users and active links", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "cl-reset-"));
    const file = path.join(dir, "r.db");
    writeFileSync(file, "garbage that is not sqlite");
    try {
      await resetDb(`file:${file}`, "admin@example.com", "AdminPass123!", "DemoPass123!", dir);
      expect(existsSync(file)).toBe(true);
      const db = createDb(`file:${file}`);
      const u = await db.all<{ role: string; n: number }>(sql`SELECT role, count(*) AS n FROM users WHERE status='ACTIVE' GROUP BY role`);
      expect(Object.fromEntries(u.map((r) => [r.role, Number(r.n)]))).toEqual({ ADMIN: 1, CUSTOMER: 1, DISTRIBUTOR: 1, PROVIDER: 2 });
      const l = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM links WHERE status='ACTIVE'`);
      expect(Number(l[0].n)).toBe(3);
      const hashes = await db.all<{ h: string }>(sql`SELECT password_hash AS h FROM users WHERE email LIKE '%@example.com' AND role <> 'ADMIN'`);
      expect(new Set(hashes.map((r) => r.h)).size).toBe(4); // per-user salts
      await expect(seedDemo(db, "DemoPass123!")).resolves.toBe(0); // idempotent
      await db.run(sql`UPDATE users SET role = 'CUSTOMER' WHERE email = 'giri@example.com'`);
      await expect(seedDemo(db, "DemoPass123!")).rejects.toThrow(/giri@example.com/);
      await resetDb(`file:${file}`, "admin@example.com", "AdminPass123!", "DemoPass123!", dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
