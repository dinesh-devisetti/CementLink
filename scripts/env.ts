import { z } from "zod";

const scriptEnv = z.object({
  DATABASE_URL: z.string().min(1),
  DATABASE_AUTH_TOKEN: z.string().optional(),
  ADMIN_SEED_EMAIL: z.string().email().optional(),
  ADMIN_SEED_PASSWORD: z.string().min(10, "ADMIN_SEED_PASSWORD must be at least 10 characters").optional(),
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
