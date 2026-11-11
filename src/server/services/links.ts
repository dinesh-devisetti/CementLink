import { sql } from "drizzle-orm";
import { v7 as uuidv7 } from "uuid";
import type { Db } from "../db/client";
import { AppError } from "../errors";
import type { LinkKind, LinkStatus, User } from "../db/schema";
import { activeLink } from "../db/fragments";
import { partyLabel } from "./party-label";

/** Hours a lower-tier party must wait before re-requesting a link the upper tier rejected. */
export const REJECT_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface LinkRow {
  id: string;
  kind: LinkKind;
  status: LinkStatus;
  /** "outgoing" = the caller requested it; "incoming" = someone requested it from the caller. */
  direction: "incoming" | "outgoing";
  /** Which side of the link the caller is. */
  side: "upper" | "lower";
  counterpart: { id: string; businessName: string; city: string | null };
  createdAt: number;
  updatedAt: number;
}

interface RawLink {
  id: string;
  kind: LinkKind;
  status: LinkStatus;
  upper_id: string;
  requested_by: string;
  created_at: number;
  updated_at: number;
  c_id: string;
  c_role: string;
  c_name: string;
  c_business: string | null;
  c_city: string | null;
}

const visible = (actorId: string) => sql`((l.lower_id = ${actorId} AND (l.status = 'ACTIVE' OR (l.status IN ('PENDING','REJECTED') AND l.requested_by = ${actorId})))
            OR (l.upper_id = ${actorId} AND (l.status IN ('PENDING','ACTIVE') OR (l.status = 'REVOKED' AND l.revoked_by IS NOT NULL))))`;

/**
 * Visibility: a lower-tier caller sees ACTIVE links plus its own PENDING/REJECTED requests (never others').
 * An upper-tier caller sees PENDING requests to it, ACTIVE links and links that were revoked after being active,
 * never links it rejected or requests the requester cancelled (revoked_by is NULL for those).
 * Counterparts expose id, business name and city only (no personal name, email or phone).
 * Incoming PENDING requests sort first, so page 1 always shows them (up to the page size).
 */
export async function listLinks(
  db: Db,
  actor: User,
  opts: { kind?: LinkKind; page: number; limit: number },
): Promise<{ rows: LinkRow[]; total: number }> {
  const kind = opts.kind ? sql`AND l.kind = ${opts.kind}` : sql``;
  const rows = await db.all<RawLink>(
    sql`SELECT l.id, l.kind, l.status, l.upper_id, l.requested_by, l.created_at, l.updated_at,
               c.id AS c_id, c.role AS c_role, c.name AS c_name, c.business_name AS c_business, c.city AS c_city
        FROM links l
        JOIN users c ON c.id = CASE WHEN l.upper_id = ${actor.id} THEN l.lower_id ELSE l.upper_id END
        WHERE ${visible(actor.id)} ${kind}
        ORDER BY CASE WHEN l.status = 'PENDING' AND l.requested_by <> ${actor.id} THEN 0 ELSE 1 END, l.updated_at DESC, l.id
        LIMIT ${opts.limit} OFFSET ${(opts.page - 1) * opts.limit}`,
  );
  const [t] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM links l WHERE ${visible(actor.id)} ${kind}`);
  return {
    total: Number(t?.n ?? 0),
    rows: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      status: r.status,
      direction: r.requested_by === actor.id ? "outgoing" : "incoming",
      side: r.upper_id === actor.id ? "upper" : "lower",
      // A distributor viewing its own customer may see that customer's personal name when no business name is set.
      counterpart: {
        id: r.c_id,
        businessName: partyLabel(r.c_business, r.c_role, r.c_id, r.upper_id === actor.id && r.c_role === "CUSTOMER" ? r.c_name : null),
        city: r.c_city,
      },
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  };
}

const REQUEST_TARGET: Record<string, { kind: LinkKind; targetRole: "PROVIDER" | "DISTRIBUTOR" } | undefined> = {
  DISTRIBUTOR: { kind: "PROVIDER_DISTRIBUTOR", targetRole: "PROVIDER" },
  CUSTOMER: { kind: "DISTRIBUTOR_CUSTOMER", targetRole: "DISTRIBUTOR" },
};

/**
 * Lower tier requests a link to an approved upper-tier party (C: one INSERT...SELECT).
 * REJECTED or REVOKED links go back to PENDING through ON CONFLICT; PENDING/ACTIVE ones are a 409.
 */
export async function requestLink(db: Db, actor: User, targetId: string, now = Date.now()): Promise<void> {
  const cfg = REQUEST_TARGET[actor.role];
  if (!cfg) throw new AppError("FORBIDDEN", "Not allowed", 403);
  const res = await db.run(sql`
    INSERT INTO links (id, kind, upper_id, lower_id, status, requested_by, created_at, updated_at)
    SELECT ${uuidv7()}, ${cfg.kind}, t.id, ${actor.id}, 'PENDING', ${actor.id}, ${now}, ${now}
    FROM users t
    WHERE t.id = ${targetId} AND t.role = ${cfg.targetRole} AND t.status = 'ACTIVE'
      AND EXISTS (SELECT 1 FROM users a WHERE a.id = ${actor.id} AND a.status = 'ACTIVE')
    ON CONFLICT (upper_id, lower_id) DO UPDATE
      SET status = 'PENDING', requested_by = excluded.requested_by, decided_at = NULL, revoked_by = NULL, updated_at = excluded.updated_at
      WHERE links.status = 'REVOKED'
         OR (links.status = 'REJECTED' AND (links.decided_at IS NULL OR links.decided_at <= ${now - REJECT_COOLDOWN_MS}))`);
  if (res.rowsAffected > 0) return;
  const [target] = await db.all<{ ok: number }>(
    sql`SELECT 1 AS ok FROM users WHERE id = ${targetId} AND role = ${cfg.targetRole} AND status = 'ACTIVE'`,
  );
  if (!target) throw new AppError("NOT_FOUND", "Party not found", 404);
  const [existing] = await db.all<{ status: LinkStatus; decided_at: number | null }>(
    sql`SELECT status, decided_at FROM links WHERE upper_id = ${targetId} AND lower_id = ${actor.id}`,
  );
  if (!existing) throw new AppError("PARTY_INACTIVE", "Your account is not active", 403);
  if (existing.status === "ACTIVE") throw new AppError("ALREADY_LINKED", "Already linked", 409);
  if (existing.status === "REJECTED") {
    const waitMs = (existing.decided_at ?? 0) + REJECT_COOLDOWN_MS - now;
    throw new AppError("REQUEST_COOLDOWN", "This request was declined recently. You can ask again after 24 hours.", 429, Math.max(1, Math.ceil(waitMs / 1000)));
  }
  throw new AppError("LINK_PENDING", "A link request is already pending", 409);
}

/** Upper tier approves or rejects a PENDING request addressed to it (C). */
export async function decideLink(db: Db, actor: User, linkId: string, decision: "approve" | "reject", now = Date.now()): Promise<void> {
  const status: LinkStatus = decision === "approve" ? "ACTIVE" : "REJECTED";
  const res = await db.run(sql`
    UPDATE links SET status = ${status}, decided_at = ${now}, updated_at = ${now}
    WHERE id = ${linkId} AND upper_id = ${actor.id} AND status = 'PENDING'
      AND EXISTS (SELECT 1 FROM users u WHERE u.id = links.lower_id AND u.status = 'ACTIVE')`);
  if (res.rowsAffected > 0) return;
  await diagnose(db, actor, linkId, "PENDING", "upper");
}

/** Either side revokes an ACTIVE link (C). Existing documents stay; new orders and POs are blocked by activeLink. */
export async function revokeLink(db: Db, actor: User, linkId: string, now = Date.now()): Promise<void> {
  const res = await db.run(sql`
    UPDATE links SET status = 'REVOKED', revoked_by = ${actor.id}, updated_at = ${now}
    WHERE id = ${linkId} AND (upper_id = ${actor.id} OR lower_id = ${actor.id}) AND status = 'ACTIVE'`);
  if (res.rowsAffected > 0) return;
  await diagnose(db, actor, linkId, "ACTIVE", "either");
}

/**
 * The requester withdraws its own PENDING request (C). Status becomes REVOKED with revoked_by left NULL, so the
 * upper tier never sees it and the 24h rejection cooldown does not apply: re-requesting works immediately.
 */
export async function cancelLink(db: Db, actor: User, linkId: string, now = Date.now()): Promise<void> {
  const res = await db.run(sql`
    UPDATE links SET status = 'REVOKED', decided_at = ${now}, updated_at = ${now}
    WHERE id = ${linkId} AND requested_by = ${actor.id} AND lower_id = ${actor.id} AND status = 'PENDING'`);
  if (res.rowsAffected > 0) return;
  const [row] = await db.all<{ status: LinkStatus; requested_by: string; lower_id: string }>(
    sql`SELECT status, requested_by, lower_id FROM links WHERE id = ${linkId}`,
  );
  if (!row || row.requested_by !== actor.id || row.lower_id !== actor.id) throw new AppError("NOT_FOUND", "Link not found", 404);
  throw new AppError("INVALID_STATE", `Link is ${row.status.toLowerCase()}, only a pending request can be cancelled`, 409);
}

/** Out-of-scope rows are 404 (never 403) so link ids of other parties are not confirmable. */
async function diagnose(db: Db, actor: User, linkId: string, needed: LinkStatus, who: "upper" | "either"): Promise<never> {
  const [row] = await db.all<{ status: LinkStatus; upper_id: string; lower_id: string }>(
    sql`SELECT status, upper_id, lower_id FROM links WHERE id = ${linkId}`,
  );
  const mine = row && (who === "either" ? row.upper_id === actor.id || row.lower_id === actor.id : row.upper_id === actor.id);
  if (!row || !mine) throw new AppError("NOT_FOUND", "Link not found", 404);
  if (row.status !== needed) throw new AppError("INVALID_STATE", `Link is ${row.status.toLowerCase()}, expected ${needed.toLowerCase()}`, 409);
  throw new AppError("PARTY_INACTIVE", "The other party is not active", 409);
}

/** Admin forces an ACTIVE link between two ACTIVE parties of the right roles (C, idempotent). Returns the link id. */
export async function forceLink(db: Db, admin: User, upperId: string, lowerId: string, now = Date.now()): Promise<string> {
  if (upperId === lowerId) throw new AppError("INVALID_PAIR", "A party cannot be linked to itself", 422);
  await db.run(sql`
    INSERT INTO links (id, kind, upper_id, lower_id, status, requested_by, decided_at, created_at, updated_at)
    SELECT ${uuidv7()},
           CASE WHEN u.role = 'PROVIDER' THEN 'PROVIDER_DISTRIBUTOR' ELSE 'DISTRIBUTOR_CUSTOMER' END,
           u.id, l.id, 'ACTIVE', ${admin.id}, ${now}, ${now}, ${now}
    FROM users u JOIN users l ON l.id = ${lowerId}
    WHERE u.id = ${upperId} AND u.id <> l.id AND u.status = 'ACTIVE' AND l.status = 'ACTIVE'
      AND ((u.role = 'PROVIDER' AND l.role = 'DISTRIBUTOR') OR (u.role = 'DISTRIBUTOR' AND l.role = 'CUSTOMER'))
    ON CONFLICT (upper_id, lower_id) DO UPDATE
      SET status = 'ACTIVE', requested_by = excluded.requested_by, decided_at = excluded.decided_at, revoked_by = NULL, updated_at = excluded.updated_at
      WHERE links.status <> 'ACTIVE'`);
  const [row] = await db.all<{ id: string }>(
    sql`SELECT id FROM links WHERE upper_id = ${upperId} AND lower_id = ${lowerId} AND status = 'ACTIVE' AND ${activeLink(upperId, lowerId)}`,
  );
  if (row) return row.id;
  const found = await db.all<{ id: string; role: string; status: string }>(
    sql`SELECT id, role, status FROM users WHERE id IN (${upperId}, ${lowerId})`,
  );
  if (found.length < 2) throw new AppError("NOT_FOUND", "Party not found", 404);
  throw new AppError("INVALID_PAIR", "Both parties must be active, as provider-distributor or distributor-customer", 422);
}
