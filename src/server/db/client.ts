import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import * as schema from "./schema";
import { getConfig } from "../config";

export const BUSY_TIMEOUT_MS = 5000;

export function createDb(url: string, authToken?: string) {
  // Local SQLite file: every pooled connection waits for a concurrent writer instead of failing with SQLITE_BUSY.
  const client = createClient({ url, authToken: authToken || undefined, timeout: BUSY_TIMEOUT_MS });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;

let singleton: Db | undefined;

export function getDb(): Db {
  if (!singleton) {
    const c = getConfig();
    singleton = createDb(c.DATABASE_URL, c.DATABASE_AUTH_TOKEN);
  }
  return singleton;
}
