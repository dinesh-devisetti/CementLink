import { DASHBOARD_PATH } from "@/lib/roles";
import type { Role, UserStatus } from "../db/schema";

export interface ActorLike {
  id: string;
  role: Role;
  status: UserStatus;
}

export type ApiDecision =
  | { ok: true }
  | { ok: false; httpStatus: 401 | 403; code: "UNAUTHENTICATED" | "PENDING" | "FORBIDDEN" };

/** API guard decision: 401 no session, 403 PENDING when not ACTIVE, 403 FORBIDDEN on wrong role. */
export function decideApi(actor: ActorLike | null, roles: readonly Role[]): ApiDecision {
  if (!actor) return { ok: false, httpStatus: 401, code: "UNAUTHENTICATED" };
  if (actor.status !== "ACTIVE") return { ok: false, httpStatus: 403, code: "PENDING" };
  if (!roles.includes(actor.role)) return { ok: false, httpStatus: 403, code: "FORBIDDEN" };
  return { ok: true };
}

export type PageDecision = { ok: true } | { ok: false; redirectTo: string };

/** Page guard decision: where to send the visitor, or ok. */
export function decidePage(actor: ActorLike | null, roles: readonly Role[]): PageDecision {
  if (!actor) return { ok: false, redirectTo: "/login" };
  if (actor.status !== "ACTIVE") return { ok: false, redirectTo: "/pending" };
  if (!roles.includes(actor.role)) return { ok: false, redirectTo: DASHBOARD_PATH[actor.role] };
  return { ok: true };
}
