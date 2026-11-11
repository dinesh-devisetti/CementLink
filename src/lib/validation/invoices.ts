import { z } from "zod";
import { MAX_PRICE_PAISE } from "../constants";
import { parseRupeesToPaise } from "../money";
import { MAX_TOTAL_BAGS, todayIst } from "../qty-input";
import { limitSchema, pageSchema } from "./pagination";

export const MIN_INVOICE_DATE = "2000-01-01";
const INVOICE_NO_RE = /^[A-Za-z0-9][A-Za-z0-9\-/_.]{0,39}$/;

function isRealDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

/**
 * Factory so tests can inject "now". Amount is never accepted from the client: the server computes qty x rate.
 * Invoice numbers are stored upper-cased so "inv-1" and "INV-1" cannot both exist.
 */
export function createInvoiceSchema(now: Date = new Date()) {
  return z
    .object({
      invoiceNo: z
        .string()
        .trim()
        .regex(INVOICE_NO_RE, "Use 1-40 letters, digits, - / _ . (start with a letter or digit)"),
      invoiceDate: z
        .string()
        .refine(isRealDate, "Enter a valid date")
        .refine((d) => !isRealDate(d) || d >= MIN_INVOICE_DATE, "Date is too old")
        .refine((d) => !isRealDate(d) || d <= todayIst(now), "Date cannot be in the future"),
      qtyBags: z.number().int("Must be a whole number of bags").min(1, "Must be at least 1 bag").max(MAX_TOTAL_BAGS),
      ratePerBag: z.string().trim().max(12),
    })
    .strict()
    .transform((v, ctx) => {
      try {
        const paise = parseRupeesToPaise(v.ratePerBag);
        if (paise <= 0 || paise > MAX_PRICE_PAISE) throw new Error("range");
        return {
          invoiceNo: v.invoiceNo.toUpperCase(),
          invoiceDate: v.invoiceDate,
          qtyBags: v.qtyBags,
          ratePerBagPaise: paise,
        };
      } catch {
        ctx.addIssue({ code: "custom", path: ["ratePerBag"], message: "Enter a rate like 385.50" });
        return z.NEVER;
      }
    });
}

export const invoiceQuerySchema = z.object({ page: pageSchema, limit: limitSchema });
