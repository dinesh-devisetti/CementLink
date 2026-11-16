import { z } from "zod";
import { MAX_RATE_PER_TONNE_PAISE } from "../constants";
import { istDate } from "../dates";
import { parseRupeesToPaise } from "../money";
import { invoiceAmountPaise, MIN_INVOICE_DATE } from "./provider-invoices";
import { limitSchema, pageSchema } from "./pagination";

const id = z.string().regex(/^[A-Za-z0-9-]{1,64}$/, "Invalid id");
export const customerInvoiceIdSchema = id;
export const paymentIdSchema = id;
const INVOICE_NO_RE = /^[A-Za-z0-9][A-Za-z0-9\-/_.]{0,39}$/;

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** POST /orders/:id/invoice. Qty comes from the order and the amount is computed server-side; neither is accepted from the client. */
export function createCustomerInvoiceSchema(now: Date = new Date()) {
  return z
    .object({
      invoiceNo: z.string().trim().regex(INVOICE_NO_RE, "Use 1-40 letters, digits, - / _ . (start with a letter or digit)"),
      invoiceDate: z
        .string()
        .refine(isRealDate, "Enter a valid date")
        .refine((d) => !isRealDate(d) || d >= MIN_INVOICE_DATE, "Date is too old")
        .refine((d) => !isRealDate(d) || d <= istDate(now.getTime()), "Date cannot be in the future"),
      ratePerTonne: z.string().trim().max(12),
    })
    .strict()
    .transform((v, ctx) => {
      let rate = 0;
      try {
        rate = parseRupeesToPaise(v.ratePerTonne);
        if (rate < 1 || rate > MAX_RATE_PER_TONNE_PAISE) throw new Error("range");
      } catch {
        ctx.addIssue({ code: "custom", path: ["ratePerTonne"], message: "Enter a rate in Rs per tonne, like 6500" });
        return z.NEVER;
      }
      return { invoiceNo: v.invoiceNo.toUpperCase(), invoiceDate: v.invoiceDate, ratePerTonnePaise: rate };
    });
}
export type CreateCustomerInvoiceInput = z.output<ReturnType<typeof createCustomerInvoiceSchema>>;
export { invoiceAmountPaise };

export const createPaymentOrderSchema = z.object({ customerInvoiceId: id }).strict();
export const verifyPaymentSchema = z
  .object({
    razorpayOrderId: z.string().regex(/^[A-Za-z0-9_]{1,64}$/),
    razorpayPaymentId: z.string().regex(/^[A-Za-z0-9_]{1,64}$/),
    razorpaySignature: z.string().regex(/^[A-Za-z0-9_]{1,128}$/),
  })
  .strict();
export type VerifyPaymentInput = z.output<typeof verifyPaymentSchema>;

export const listQuerySchema = z.object({ page: pageSchema, limit: limitSchema }).strict();
