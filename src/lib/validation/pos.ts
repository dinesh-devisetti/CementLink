import { z } from "zod";
import { parseRupeesToPaise } from "../money";
import { MAX_TOTAL_BAGS } from "../qty-input";
import { MAX_PRICE_PAISE } from "./lines";
import { limitSchema, pageSchema } from "./pagination";
import { requestIdSchema } from "./requests";

/** Rate is a rupee string ("385.50") converted to integer paise; qty is whole bags. */
export const createPoSchema = z
  .object({
    providerId: requestIdSchema,
    qtyBags: z.number().int().min(1).max(MAX_TOTAL_BAGS),
    ratePerBag: z.string().trim().max(12),
  })
  .strict()
  .transform((v, ctx) => {
    try {
      const paise = parseRupeesToPaise(v.ratePerBag);
      if (paise <= 0 || paise > MAX_PRICE_PAISE) throw new Error("range");
      return { providerId: v.providerId, qtyBags: v.qtyBags, ratePerBagPaise: paise };
    } catch {
      ctx.addIssue({ code: "custom", path: ["ratePerBag"], message: "Enter a rate like 385.50" });
      return z.NEVER;
    }
  });

export const poQuerySchema = z.object({ page: pageSchema, limit: limitSchema });
