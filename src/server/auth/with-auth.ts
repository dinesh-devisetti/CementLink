import type { NextResponse } from "next/server";
import type { Role, User } from "../db/schema";
import { checkOrigin, requireRole } from "./guards";
import { handleError } from "./http";

export interface AuthCtx<P> {
  actor: User;
  req: Request;
  params: P;
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Wraps a route handler so every API enforces, in order: Origin check (mutating methods),
 * requireRole (401/403), and uniform error mapping. Use for all non-public API routes.
 */
export function withAuth<P = Record<string, never>>(
  roles: readonly Role[],
  handler: (ctx: AuthCtx<P>) => Promise<NextResponse>,
) {
  return async (req: Request, route: { params: Promise<P> }): Promise<NextResponse> => {
    try {
      if (!SAFE_METHODS.has(req.method.toUpperCase())) {
        const bad = await checkOrigin();
        if (bad) return bad;
      }
      const auth = await requireRole(...roles);
      if ("response" in auth) return auth.response;
      const params = (await route?.params) ?? ({} as P);
      return await handler({ actor: auth.actor, req, params });
    } catch (err) {
      return handleError(err);
    }
  };
}
