import "dotenv/config";
import { eq } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import { createDb, type Db } from "../src/server/db/client";
import { links, users, type LinkKind, type Role } from "../src/server/db/schema";
import { hashPassword } from "../src/server/auth/password";
import { seedAdmin } from "../src/server/services/users";
import { demoSeedAllowed, fail, readScriptEnv } from "./env";

type Demo = { key: string; email: string; role: Role; name: string; businessName: string; city: string; phone: string };

export const DEMO_USERS: readonly Demo[] = [
  { key: "ramu", email: "ramu@example.com", role: "CUSTOMER", name: "Ramu", businessName: "Ramu Constructions", city: "Hyderabad", phone: "9000000001" },
  { key: "giri", email: "giri@example.com", role: "DISTRIBUTOR", name: "Giri", businessName: "Giri Traders", city: "Hyderabad", phone: "9000000002" },
  { key: "anjani", email: "anjani@example.com", role: "PROVIDER", name: "Anjani Cement", businessName: "Anjani Cement", city: "Nalgonda", phone: "9000000003" },
  { key: "ambuja", email: "ambuja@example.com", role: "PROVIDER", name: "Ambuja Cement", businessName: "Ambuja Cement", city: "Nalgonda", phone: "9000000004" },
];

/** [upper, lower, kind]: Anjani-Giri, Ambuja-Giri, Giri-Ramu. */
export const DEMO_LINKS: readonly [string, string, LinkKind][] = [
  ["anjani", "giri", "PROVIDER_DISTRIBUTOR"],
  ["ambuja", "giri", "PROVIDER_DISTRIBUTOR"],
  ["giri", "ramu", "DISTRIBUTOR_CUSTOMER"],
];

/** Idempotent v2 demo data: all users ACTIVE, all links ACTIVE. Each user gets its own salted hash. Returns users created. */
export async function seedDemo(db: Db, password: string, now = Date.now()): Promise<number> {
  const ids = new Map<string, string>();
  let created = 0;
  for (const d of DEMO_USERS) {
    const [existing] = await db
      .select({ id: users.id, role: users.role, status: users.status })
      .from(users)
      .where(eq(users.email, d.email))
      .limit(1);
    if (existing) {
      if (existing.role !== d.role || existing.status !== "ACTIVE") {
        throw new Error(`Existing user ${d.email} has role ${existing.role} / status ${existing.status}; expected ${d.role} / ACTIVE`);
      }
      ids.set(d.key, existing.id);
      continue;
    }
    const id = uuidv7();
    await db.insert(users).values({
      id, email: d.email, passwordHash: await hashPassword(password), role: d.role, status: "ACTIVE", name: d.name,
      businessName: d.businessName, phone: d.phone, city: d.city, createdAt: now,
    });
    ids.set(d.key, id);
    created += 1;
  }
  for (const [upper, lower, kind] of DEMO_LINKS) {
    const upperId = ids.get(upper) as string;
    const lowerId = ids.get(lower) as string;
    await db
      .insert(links)
      .values({
        id: uuidv7(), kind, upperId, lowerId, status: "ACTIVE", requestedBy: lowerId,
        decidedAt: now, createdAt: now, updatedAt: now,
      })
      .onConflictDoNothing();
  }
  return created;
}

/** Seeds the admin; seeds demo data only when demoPassword is given and demoSeedAllowed(url). */
export async function runSeed(url: string, token: string | undefined, email: string, password: string, demoPassword?: string) {
  const db = createDb(url, token);
  const adminCreated = await seedAdmin(db, email, password);
  if (demoPassword && demoSeedAllowed(url)) await seedDemo(db, demoPassword);
  return adminCreated;
}

/** Resolves the demo password for this DB, or undefined when demo seeding is not allowed. Throws if allowed but unset. */
export function demoPasswordFor(url: string, env: { DEMO_SEED_PASSWORD?: string }): string | undefined {
  if (!demoSeedAllowed(url)) return undefined;
  if (!env.DEMO_SEED_PASSWORD) throw new Error("DEMO_SEED_PASSWORD is required for demo seeding on this database");
  return env.DEMO_SEED_PASSWORD;
}

if (process.argv[1]?.endsWith("seed.ts")) {
  try {
    const env = readScriptEnv();
    if (!env.ADMIN_SEED_EMAIL || !env.ADMIN_SEED_PASSWORD) {
      throw new Error("ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD are required");
    }
    runSeed(env.DATABASE_URL, env.DATABASE_AUTH_TOKEN, env.ADMIN_SEED_EMAIL, env.ADMIN_SEED_PASSWORD, demoPasswordFor(env.DATABASE_URL, env))
      .then((created) => console.log(created ? "admin created" : "admin already exists"))
      .catch(fail);
  } catch (e) {
    fail(e);
  }
}
