import { z } from "zod";
import { MAX_RATE_PER_TONNE_PAISE } from "../constants";
import { istDate } from "../dates";
import { parseRupeesToPaise } from "../money";
import { INVALID_TONNES, tonnesToKg } from "../qty";
import { limitSchema, pageSchema } from "./pagination";

export const MIN_INVOICE_DATE = "2000-01-01";
const INVOICE_NO_RE = /^[A-Za-z0-9][A-Za-z0-9\-/_.]{0,39}$/;

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/** Amount in paise, rounded half up: the same formula as the amount CHECK and the INSERT. */
export const invoiceAmountPaise = (qtyKg: number, ratePerTonnePaise: number): number => Math.floor((qtyKg * ratePerTonnePaise + 500) / 1000);

/**
 * POST /pos/:id/invoices. Factory so tests can inject "now". The amount is never accepted from the client: the server
 * computes it from qty x rate and rejects a result of 0 paise. Invoice numbers are stored upper-cased.
 */
export function createProviderInvoiceSchema(now: Date = new Date()) {
  return z
    .object({
      invoiceNo: z.string().trim().regex(INVOICE_NO_RE, "Use 1-40 letters, digits, - / _ . (start with a letter or digit)"),
      invoiceDate: z
        .string()
        .refine(isRealDate, "Enter a valid date")
        .refine((d) => !isRealDate(d) || d >= MIN_INVOICE_DATE, "Date is too old")
        .refine((d) => !isRealDate(d) || d <= istDate(now.getTime()), "Date cannot be in the future"),
      qtyTonnes: z.string().trim().max(10),
      ratePerTonne: z.string().trim().max(12),
    })
    .strict()
    .transform((v, ctx) => {
      let qtyKg = 0;
      let rate = 0;
      try {
        qtyKg = tonnesToKg(v.qtyTonnes);
      } catch {
        ctx.addIssue({ code: "custom", path: ["qtyTonnes"], message: INVALID_TONNES });
        return z.NEVER;
      }
      try {
        rate = parseRupeesToPaise(v.ratePerTonne);
        if (rate < 1 || rate > MAX_RATE_PER_TONNE_PAISE) throw new Error("range");
      } catch {
        ctx.addIssue({ code: "custom", path: ["ratePerTonne"], message: "Enter a rate in Rs per tonne, like 5400.50" });
        return z.NEVER;
      }
      if (invoiceAmountPaise(qtyKg, rate) <= 0) {
        ctx.addIssue({ code: "custom", path: ["ratePerTonne"], message: "Amount must be more than Rs 0" });
        return z.NEVER;
      }
      return { invoiceNo: v.invoiceNo.toUpperCase(), invoiceDate: v.invoiceDate, qtyKg, ratePerTonnePaise: rate };
    });
}
export type CreateProviderInvoiceInput = z.output<ReturnType<typeof createProviderInvoiceSchema>>;

export const providerInvoiceQuerySchema = z.object({ page: pageSchema, limit: limitSchema }).strict();
