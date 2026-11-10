import { z } from "zod";
import { parseRupeesToPaise } from "../money";
import { LINE_STATUSES } from "../../server/db/schema";
import { pageSchema } from "./pagination";

export const MAX_PRICE_PAISE = 10_000_000; // Rs 1,00,000 per bag is far above any real price

/** Price is a rupee string ("385.50"); converted to integer paise with no floats. */
export const acceptLineSchema = z
  .object({ pricePerBag: z.string().trim().max(12) })
  .strict()
  .transform((v, ctx) => {
    try {
      const paise = parseRupeesToPaise(v.pricePerBag);
      if (paise <= 0 || paise > MAX_PRICE_PAISE) throw new Error("range");
      return { pricePerBagPaise: paise };
    } catch {
      ctx.addIssue({ code: "custom", path: ["pricePerBag"], message: "Enter a price like 385.50" });
      return z.NEVER;
    }
  });

export const lineQuerySchema = z.object({
  status: z.enum(LINE_STATUSES).optional(),
  page: pageSchema,
  limit: z.coerce.number().int().min(1).max(50).default(20),
});
