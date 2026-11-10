import { z } from "zod";

/** User ids are uuids; accept only a safe charset and length so junk never reaches the DB. */
export const userIdSchema = z.string().regex(/^[A-Za-z0-9-]{1,64}$/, "Invalid id");
