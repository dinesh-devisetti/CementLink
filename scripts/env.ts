import { z } from "zod";

const scriptEnv = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_AUTH_TOKEN: z.string().optional(),
  ADMIN_SEED_EMAIL: z.string().email().optional(),
  ADMIN_SEED_PASSWORD: z.string().min(10, "ADMIN_SEED_PASSWORD must be at least 10 characters").optional(),
  DEMO_SEED_PASSWORD: z.string().min(10, "DEMO_SEED_PASSWORD must be at least 10 characters").optional(),
  SEED_DEMO: z.enum(["true", "false"]).optional(),
});

export function readScriptEnv(env: Record<string, string | undefined> = process.env) {
  const r = scriptEnv.safeParse(env);
  if (!r.success) {
    throw new Error(r.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "));
  }
  return r.data;
}

export function fail(err: unknown): never {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}

/** Demo accounts are allowed on local file: databases, or with SEED_DEMO=true; never on VERCEL or NODE_ENV=production. */
export function demoSeedAllowed(url: string, env: Record<string, string | undefined> = process.env): boolean {
  if (env.VERCEL || env.NODE_ENV === "production") return false;
  return url.startsWith("file:") || env.SEED_DEMO === "true";
}
