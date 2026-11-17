import { z } from "zod";
import { limitSchema, pageSchema } from "./pagination";

/** Admin analytics list query: page <= MAX_PAGE, limit <= 50. Unknown params are ignored; bad values are 400. */
export const analyticsQuerySchema = z.object({ page: pageSchema, limit: limitSchema });

export function parseAnalyticsQuery(req: Request) {
  const sp = new URL(req.url).searchParams;
  return analyticsQuerySchema.parse({ page: sp.get("page") ?? undefined, limit: sp.get("limit") ?? undefined });
}
