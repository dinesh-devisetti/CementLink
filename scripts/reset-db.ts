import "dotenv/config";
import { rmSync } from "node:fs";
import { createClient } from "@libsql/client";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./migrate";
import { assertDistinctPasswords, demoPasswordFor, runSeed } from "./seed";
import { fail, readScriptEnv } from "./env";

/**
 * Local SQLite file behind a file: URL, or throws. Remote URLs, file:// URLs with an authority,
 * and empty paths are refused. Query strings (including mode=ro) are ignored here; openAndValidate
 * rejects URLs libsql cannot open before any file is deleted.
 */
export function localDbPath(url: string): string {
  if (!url.startsWith("file:")) throw new Error("reset-db only works on a local file: DATABASE_URL (refusing remote database)");
  const rest = url.slice("file:".length).split(/[?#]/)[0];
  if (rest.startsWith("//") && !rest.startsWith("///")) throw new Error("file:// URLs with a host are not supported");
  let p: string;
  try {
    p = rest.startsWith("//") ? fileURLToPath(`file:${rest}`) : decodeURIComponent(rest);
  } catch {
    throw new Error("DATABASE_URL is not a valid file path");
  }
  if (!p || p.endsWith("/") || p.includes("\0")) throw new Error("DATABASE_URL has no usable file path");
  return path.resolve(p);
}

export function assertNotProduction(env: Record<string, string | undefined> = process.env): void {
  if (env.VERCEL || env.NODE_ENV === "production") throw new Error("reset-db refuses to run when VERCEL or NODE_ENV=production is set");
}

/** Opens the URL with libsql and runs a trivial statement, so a URL that cannot be opened fails before any delete. */
export async function openAndValidate(url: string): Promise<void> {
  const client = createClient({ url });
  try {
    await client.execute("SELECT 1");
  } finally {
    client.close();
  }
}

/** The file to delete must be a *.db file inside `root` (the repo directory), never an arbitrary path. */
export function assertInsideRoot(file: string, root: string): void {
  const rel = path.relative(path.resolve(root), file);
  if (!file.endsWith(".db") || !rel || rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`reset-db only deletes .db files inside ${path.resolve(root)}`);
  }
}

export async function resetDb(url: string, email: string, password: string, demoPassword?: string, root: string = process.cwd()): Promise<string> {
  assertNotProduction();
  assertDistinctPasswords(password, demoPassword);
  const file = localDbPath(url);
  assertInsideRoot(file, root);
  await openAndValidate(url);
  for (const suffix of ["", "-wal", "-shm", "-journal"]) rmSync(`${file}${suffix}`, { force: true });
  await runMigrations(url);
  await runSeed(url, undefined, email, password, demoPassword);
  return file;
}

if (process.argv[1]?.endsWith("reset-db.ts")) {
  try {
    const env = readScriptEnv();
    if (!env.ADMIN_SEED_EMAIL || !env.ADMIN_SEED_PASSWORD) {
      throw new Error("ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD are required");
    }
    resetDb(env.DATABASE_URL, env.ADMIN_SEED_EMAIL, env.ADMIN_SEED_PASSWORD, demoPasswordFor(env.DATABASE_URL, env))
      .then((f) => console.log(`reset ${f}`))
      .catch(fail);
  } catch (e) {
    fail(e);
  }
}
