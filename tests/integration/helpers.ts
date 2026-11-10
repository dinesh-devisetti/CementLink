import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { createDb, type Db } from "@/server/db/client";

export async function makeTestDb(): Promise<{ db: Db; cleanup: () => void }> {
  const dir = mkdtempSync(path.join(tmpdir(), "cl-test-"));
  const db = createDb(`file:${path.join(dir, "test.db")}`);
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
  return { db, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}
