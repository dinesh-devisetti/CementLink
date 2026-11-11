import { z } from "zod";
import { limitSchema, pageSchema } from "./pagination";

const id = z.string().regex(/^[A-Za-z0-9-]{1,64}$/, "Invalid id");

export const linkIdSchema = id;
export const requestLinkSchema = z.object({ targetId: id }).strict();
export const adminLinkSchema = z.object({ upperId: id, lowerId: id }).strict();

export const linkListQuerySchema = z.object({
  kind: z.enum(["PROVIDER_DISTRIBUTOR", "DISTRIBUTOR_CUSTOMER"]).optional(),
  page: pageSchema,
  limit: limitSchema,
});

export const directoryQuerySchema = z.object({
  q: z.string().trim().max(60).optional(),
  page: pageSchema,
  limit: limitSchema,
});
