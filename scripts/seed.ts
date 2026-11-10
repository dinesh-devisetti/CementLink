import "dotenv/config";
import { createDb } from "../src/server/db/client";
import { seedAdmin } from "../src/server/services/users";
import { fail, readScriptEnv } from "./env";

export async function runSeed(url: string, token: string | undefined, email: string, password: string) {
  return seedAdmin(createDb(url, token), email, password);
}

if (process.argv[1]?.endsWith("seed.ts")) {
  try {
    const env = readScriptEnv();
    if (!env.ADMIN_SEED_EMAIL || !env.ADMIN_SEED_PASSWORD) {
      throw new Error("ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD are required");
    }
    runSeed(env.DATABASE_URL, env.DATABASE_AUTH_TOKEN, env.ADMIN_SEED_EMAIL, env.ADMIN_SEED_PASSWORD)
      .then((created) => console.log(created ? "admin created" : "admin already exists"))
      .catch(fail);
  } catch (e) {
    fail(e);
  }
}
