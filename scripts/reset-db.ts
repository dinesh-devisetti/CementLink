import "dotenv/config";
import { rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runMigrations } from "./migrate";
import { demoPasswordFor, runSeed } from "./seed";
import { fail, readScriptEnv } from "./env";

/**
 * Local SQLite file behind a file: URL, or throws. Remote URLs, file:// URLs with an authority,
 * empty paths and read-only URLs are refused. Query strings are ignored.
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

export async function resetDb(url: string, email: string, password: string, demoPassword?: string): Promise<string> {
  assertNotProduction();
  const file = localDbPath(url);
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
