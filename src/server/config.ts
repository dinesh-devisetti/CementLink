import { z } from "zod";

const schema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    DATABASE_URL: z.string().min(1),
    DATABASE_AUTH_TOKEN: z.string().optional(),
    APP_URL: z.string().url().optional(),
    RAZORPAY_KEY_ID: z.string().optional(),
    RAZORPAY_KEY_SECRET: z.string().optional(),
    RAZORPAY_WEBHOOK_SECRET: z.string().optional(),
    PAYMENT_GATEWAY: z.enum(["razorpay", "fake"]).optional(),
    ADMIN_SEED_EMAIL: z.string().email().optional(),
    ADMIN_SEED_PASSWORD: z.string().min(10).optional(),
    SESSION_TTL_HOURS: z.coerce.number().int().positive().default(168),
    LOGIN_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
    LOGIN_IP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(50),
    LOGIN_WINDOW_MINUTES: z.coerce.number().int().positive().default(15),
    REQUEST_MAX_PER_HOUR: z.coerce.number().int().positive().default(10),
    ACTION_MAX_PER_MIN: z.coerce.number().int().positive().default(30),
    REGISTER_MAX_PER_HOUR: z.coerce.number().int().positive().default(5),
    COOKIE_SECURE: z.enum(["true", "false"]).optional(),
    TRUST_PROXY: z.enum(["true", "false"]).default("false"),
    // Explicit e2e opt-in: the only way to run the fake gateway / insecure cookies in a production build.
    E2E: z.literal("1").optional(),
    VERCEL: z.string().optional(),
  })
  .superRefine((c, ctx) => {
    const issue = (path: string, message: string) => ctx.addIssue({ code: "custom", path: [path], message });
    if (c.RAZORPAY_KEY_ID && !c.RAZORPAY_KEY_ID.startsWith("rzp_test_")) {
      issue(
        "RAZORPAY_KEY_ID",
        c.RAZORPAY_KEY_ID.startsWith("rzp_live_")
          ? "rzp_live_ keys are refused: this app runs in Razorpay test mode only"
          : "RAZORPAY_KEY_ID must start with rzp_test_",
      );
    }
    const e2eAllowed = c.E2E === "1" && !c.VERCEL;
    if (c.E2E === "1" && c.VERCEL) issue("E2E", "E2E=1 is refused on Vercel");
    if (c.VERCEL && c.TRUST_PROXY !== "true") issue("TRUST_PROXY", "TRUST_PROXY=true is required on Vercel (IP rate limits need x-real-ip)");
    if (c.NODE_ENV === "production") {
      if (!c.APP_URL) issue("APP_URL", "APP_URL is required in production");
      if (!c.PAYMENT_GATEWAY) issue("PAYMENT_GATEWAY", "PAYMENT_GATEWAY is required in production (fake gateway needs E2E=1)");
      if (c.PAYMENT_GATEWAY === "fake" && !e2eAllowed) issue("PAYMENT_GATEWAY", "fake gateway is not allowed in production");
      if (c.COOKIE_SECURE === "false" && !e2eAllowed) issue("COOKIE_SECURE", "COOKIE_SECURE=false is not allowed in production");
    }
  })
  .transform((c) => ({
    ...c,
    APP_URL: c.APP_URL ?? "http://localhost:3000",
    PAYMENT_GATEWAY: c.PAYMENT_GATEWAY ?? ("fake" as const),
  }));

export type Config = z.infer<typeof schema>;

export function parseConfig(env: Record<string, string | undefined>): Config {
  const result = schema.safeParse(env);
  if (!result.success) {
    const msg = result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Invalid configuration: ${msg}`);
  }
  return result.data;
}

let cached: Config | undefined;

export function getConfig(): Config {
  cached ??= parseConfig(process.env);
  return cached;
}

export function resetConfigForTests(): void {
  cached = undefined;
}
