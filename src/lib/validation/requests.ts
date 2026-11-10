import { z } from "zod";
import { MAX_TOTAL_BAGS, resolveTotalBags, todayIst } from "../qty-input";

export const MAX_ALLOCATIONS = 20;
export const MAX_DAYS_AHEAD = 365;
// Control characters (incl. newlines) and bidi/zero-width overrides have no place in an address line.
const UNSAFE_TEXT = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/;
const safeText = (max: number, label: string) =>
  z.string().trim().min(1, `${label} is required`).max(max).refine((v) => !UNSAFE_TEXT.test(v), "Contains invalid characters");

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

function addDays(date: string, days: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

const allocationSchema = z.object({
  distributorId: z.string().regex(/^[A-Za-z0-9-]{1,64}$/, "Invalid id"),
  bags: z.number().int("Must be a whole number of bags").positive("Must be at least 1 bag").max(MAX_TOTAL_BAGS),
});

/** Factory so tests can inject "now". The server derives totalBags; client totals are never trusted. */
export function createRequestSchema(now: Date = new Date()) {
  return z
    .object({
      unit: z.enum(["BAGS", "TONNES"]),
      quantity: z.string().trim().min(1, "Quantity is required").max(12),
      address: safeText(300, "Address"),
      city: safeText(100, "City"),
      pincode: z.string().regex(/^[0-9]{6}$/, "Pincode must be 6 digits"),
      neededBy: z
        .string()
        .refine(isRealDate, "Enter a valid date")
        .refine((d) => !isRealDate(d) || d >= todayIst(now), "Pick today or a later date")
        .refine((d) => !isRealDate(d) || d <= addDays(todayIst(now), MAX_DAYS_AHEAD), "Pick a date within the next year"),
      allocations: z.array(allocationSchema).min(1, "Pick at least one distributor").max(MAX_ALLOCATIONS),
    })
    .strict()
    .transform((v, ctx) => {
      let totalBags = 0;
      try {
        totalBags = resolveTotalBags(v.unit, v.quantity);
      } catch (e) {
        ctx.addIssue({ code: "custom", path: ["quantity"], message: (e as Error).message });
        return z.NEVER;
      }
      if (totalBags > MAX_TOTAL_BAGS) {
        ctx.addIssue({ code: "custom", path: ["quantity"], message: "Quantity is too large" });
        return z.NEVER;
      }
      const ids = v.allocations.map((a) => a.distributorId);
      if (new Set(ids).size !== ids.length) {
        ctx.addIssue({ code: "custom", path: ["allocations"], message: "Duplicate distributor" });
        return z.NEVER;
      }
      const sum = v.allocations.reduce((s, a) => s + a.bags, 0);
      if (sum !== totalBags) {
        ctx.addIssue({
          code: "custom",
          path: ["allocations"],
          message: `Allocations must add up to ${totalBags} bags (now ${sum})`,
        });
        return z.NEVER;
      }
      return { ...v, totalBags };
    });
}

export const requestIdSchema = z.string().regex(/^[A-Za-z0-9-]{1,64}$/, "Invalid id");
