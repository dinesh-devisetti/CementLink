import { z } from "zod";

/** Deep OFFSET scans get expensive; no list needs more than this many pages. */
export const MAX_PAGE = 1000;

export const pageSchema = z.coerce.number().int().min(1).max(MAX_PAGE).default(1);
export const limitSchema = z.coerce.number().int().min(1).max(50).default(20);
