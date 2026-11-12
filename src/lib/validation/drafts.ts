import { z } from "zod";
import { MAX_RATE_PER_TONNE_PAISE } from "../constants";
import { parseRupeesToPaise } from "../money";
import { INVALID_TONNES, tonnesToKg } from "../qty";

const id = z.string().regex(/^[A-Za-z0-9-]{1,64}$/, "Invalid id");
export const poIdSchema = id;
export const poItemIdSchema = id;
export const MAX_PLACE_POS = 20;

const version = z.number().int().min(0).max(1_000_000);
const kg = z.string().transform((v, ctx) => {
  try {
    return tonnesToKg(v);
  } catch {
    ctx.addIssue({ code: "custom", message: INVALID_TONNES });
    return z.NEVER;
  }
});
const ratePaise = z.string().transform((v, ctx) => {
  try {
    const p = parseRupeesToPaise(v);
    if (p < 1 || p > MAX_RATE_PER_TONNE_PAISE) throw new Error("range");
    return p;
  } catch {
    ctx.addIssue({ code: "custom", message: "Enter a rate in Rs per tonne, up to 2 decimals" });
    return z.NEVER;
  }
});

// Control characters and bidi overrides have no place in a free-text reason.
const UNSAFE = /[\u0000-\u001F\u007F-\u009F​-‏‪-‮⁦-⁩]/;
export const rejectOrderSchema = z
  .object({ reason: z.string().trim().min(1, "Enter a reason").max(300, "Reason is too long").refine((v) => !UNSAFE.test(v), "Contains invalid characters") })
  .strict();

/** PATCH /pos/:id. providerId and ratePerTonne are each optional; null clears them. At least one is required. */
export const editPoSchema = z
  .object({ version, providerId: id.nullable().optional(), ratePerTonne: ratePaise.nullable().optional() })
  .strict()
  .refine((v) => v.providerId !== undefined || v.ratePerTonne !== undefined, { message: "Nothing to change" });
export type EditPoInput = z.output<typeof editPoSchema>;

export const editItemSchema = z.object({ version, qtyTonnes: kg }).strict();
export const splitItemSchema = z.object({ version, qtyTonnes: kg, providerId: id.nullable() }).strict();

export const placeSchema = z
  .object({
    pos: z
      .array(z.object({ id, version }).strict())
      .min(1, "Select at least one draft")
      .max(MAX_PLACE_POS, `Place at most ${MAX_PLACE_POS} at a time`),
  })
  .strict()
  .refine((v) => new Set(v.pos.map((p) => p.id)).size === v.pos.length, { message: "Each draft can appear only once", path: ["pos"] });
export type PlaceInput = z.output<typeof placeSchema>;
