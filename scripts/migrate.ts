import "dotenv/config";
import { migrate } from "drizzle-orm/libsql/migrator";
import { createDb } from "../src/server/db/client";
import { fail, readScriptEnv } from "./env";

export async function runMigrations(url: string, token?: string) {
  await migrate(createDb(url, token), { migrationsFolder: "./drizzle" });
}

if (process.argv[1]?.endsWith("migrate.ts")) {
  try {
    const env = readScriptEnv();
    runMigrations(env.DATABASE_URL, env.DATABASE_AUTH_TOKEN)
      .then(() => console.log("migrated"))
      .catch(fail);
  } catch (e) {
    fail(e);
  }
}
