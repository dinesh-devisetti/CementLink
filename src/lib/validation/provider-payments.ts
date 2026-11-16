import { z } from "zod";
import { PAYMENT_MODES } from "../constants";
import { istDate } from "../dates";
import { parseRupeesToPaise } from "../money";
import { limitSchema, pageSchema } from "./pagination";

export const MAX_PAYMENT_PAISE = 10_000_000_000;
export const MAX_REFERENCE = 64;

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** POST /provider-invoices/:id/payments. The amount is rupees as text and becomes integer paise; the date window against the invoice is checked by the service. */
export function createProviderPaymentSchema(now: Date = new Date()) {
  return z
    .object({
      amount: z.string().trim().max(12),
      paidOn: z
        .string()
        .refine(isRealDate, "Enter a valid date")
        .refine((d) => !isRealDate(d) || d <= istDate(now.getTime()), "Date cannot be in the future"),
      mode: z.enum(PAYMENT_MODES),
      reference: z.string().trim().max(MAX_REFERENCE, `At most ${MAX_REFERENCE} characters`).regex(/^[^\p{Cc}\p{Cf}]*$/u, "Remove control characters").optional(),
    })
    .strict()
    .transform((v, ctx) => {
      let amountPaise = 0;
      try {
        amountPaise = parseRupeesToPaise(v.amount);
        if (amountPaise < 1 || amountPaise > MAX_PAYMENT_PAISE) throw new Error("range");
      } catch {
        ctx.addIssue({ code: "custom", path: ["amount"], message: "Enter an amount in Rs, like 5400.50" });
        return z.NEVER;
      }
      return { amountPaise, paidOn: v.paidOn, mode: v.mode, reference: v.reference ? v.reference : null };
    });
}
export type CreateProviderPaymentInput = z.output<ReturnType<typeof createProviderPaymentSchema>>;

export const providerPaymentQuerySchema = z.object({ page: pageSchema, limit: limitSchema }).strict();
