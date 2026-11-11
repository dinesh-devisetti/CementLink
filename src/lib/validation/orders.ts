import { z } from "zod";
import { todayIst } from "../dates";
import { INVALID_TONNES, tonnesToKg } from "../qty";
import { limitSchema, pageSchema } from "./pagination";

const id = z.string().regex(/^[A-Za-z0-9-]{1,64}$/, "Invalid id");
export const orderIdSchema = id;

export const MAX_ALLOCATIONS = 20;
/** Furthest-out needed-by date accepted, in days from today (IST). */
export const MAX_NEEDED_BY_DAYS = 365;

const tonnes = z.string().superRefine((v, ctx) => {
  try {
    tonnesToKg(v);
  } catch {
    ctx.addIssue({ code: "custom", message: INVALID_TONNES });
  }
});

// Control characters (incl. newlines) and bidi/zero-width overrides have no place in an address line.
const UNSAFE_TEXT = /[\u0000-\u001F\u007F-\u009F\u200B-\u200F\u202A-\u202E\u2066-\u2069]/;
const noUnsafe = (v: string) => !UNSAFE_TEXT.test(v);
const BAD_CHARS = "Contains invalid characters";

const isRealDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
const addDays = (date: string, days: number) => new Date(new Date(`${date}T00:00:00Z`).getTime() + days * 86_400_000).toISOString().slice(0, 10);

/** Create-order body. Output quantities are integer kg. `today` is the IST date (injectable for tests). */
export function createOrderSchema(today: string = todayIst()) {
  return z
    .object({
      distributorId: id,
      qtyTonnes: tonnes,
      allocations: z
        .array(z.object({ providerId: id, qtyTonnes: tonnes }).strict())
        .max(MAX_ALLOCATIONS, `At most ${MAX_ALLOCATIONS} providers`)
        .default([]),
      neededBy: z
        .string()
        .refine(isRealDate, "Enter a valid date")
        .refine((d) => d >= today, "Needed-by date cannot be in the past")
        .refine((d) => d <= addDays(today, MAX_NEEDED_BY_DAYS), "Needed-by date is too far ahead"),
      address: z.string().trim().min(5, "Enter the delivery address").max(300, "Address is too long").refine(noUnsafe, BAD_CHARS),
      city: z.string().trim().min(1, "Enter the city").max(80, "City is too long").refine(noUnsafe, BAD_CHARS),
      pincode: z.string().regex(/^\d{6}$/, "Pincode must be 6 digits"),
    })
    .strict()
    .superRefine((v, ctx) => {
      const seen = new Set<string>();
      for (const a of v.allocations) {
        if (seen.has(a.providerId)) {
          ctx.addIssue({ code: "custom", path: ["allocations"], message: "Each provider can appear only once" });
          return;
        }
        seen.add(a.providerId);
      }
      let total: number;
      try {
        total = tonnesToKg(v.qtyTonnes);
        const sum = v.allocations.reduce((s, a) => s + tonnesToKg(a.qtyTonnes), 0);
        if (sum > total) ctx.addIssue({ code: "custom", path: ["allocations"], message: "Provider quantities exceed the order total" });
      } catch {
        // field-level issues already reported
      }
    })
    .transform((v) => ({
      distributorId: v.distributorId,
      qtyKg: tonnesToKg(v.qtyTonnes),
      allocations: v.allocations.map((a) => ({ providerId: a.providerId, qtyKg: tonnesToKg(a.qtyTonnes) })),
      neededBy: v.neededBy,
      address: v.address,
      city: v.city,
      pincode: v.pincode,
    }));
}
export type CreateOrderInput = z.output<ReturnType<typeof createOrderSchema>>;

export const ORDER_LIST_STATUSES = ["REQUESTED", "UNDER_REVIEW", "POS_PLACED", "DISPATCHED", "DELIVERED", "INVOICED", "PAID", "REJECTED", "CANCELLED"] as const;
export const orderListQuerySchema = z.object({
  status: z.enum(ORDER_LIST_STATUSES).optional(),
  page: pageSchema,
  limit: limitSchema,
});
