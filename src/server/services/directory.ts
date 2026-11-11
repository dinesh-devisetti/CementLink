import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { AppError } from "../errors";
import { activeLink } from "../db/fragments";
import type { LinkStatus, Role, User } from "../db/schema";
import { partyLabel } from "./party-label";

/** Directory rows expose only id, business name and city (+ the caller's own link state). */
export interface DirectoryRow {
  id: string;
  businessName: string;
  city: string | null;
  linkId: string | null;
  linkStatus: LinkStatus | null;
  /** Who revoked the link; null on a REVOKED link means the requester cancelled it. */
  linkRevokedBy: string | null;
}

export interface PartyRow {
  id: string;
  businessName: string;
  city: string | null;
}

const escapeLike = (q: string) => q.replace(/[\\%_]/g, (c) => `\\${c}`);

/** ACTIVE (admin-approved) users of `targetRole`, with the caller's own link to each. Never lists unapproved users. Search is on business name and city only. */
async function directory(
  db: Db,
  actor: User,
  targetRole: Role,
  opts: { q?: string; page: number; limit: number },
): Promise<{ rows: DirectoryRow[]; total: number }> {
  const q = opts.q ? `%${escapeLike(opts.q.toLowerCase())}%` : null;
  // The target is always the upper tier (provider for a distributor, distributor for a customer).
  const join = sql`l.upper_id = t.id AND l.lower_id = ${actor.id}`;
  const search = q
    ? sql`AND (lower(coalesce(t.business_name, '')) LIKE ${q} ESCAPE '\\' OR lower(coalesce(t.city, '')) LIKE ${q} ESCAPE '\\')`
    : sql``;
  const where = sql`t.role = ${targetRole} AND t.status = 'ACTIVE' AND t.id <> ${actor.id} ${search}`;
  const rows = await db.all<{ id: string; business_name: string | null; city: string | null; link_id: string | null; link_status: LinkStatus | null; revoked_by: string | null }>(
    sql`SELECT t.id AS id, t.business_name AS business_name, t.city AS city, l.id AS link_id, l.status AS link_status, l.revoked_by AS revoked_by
        FROM users t LEFT JOIN links l ON ${join}
        WHERE ${where}
        ORDER BY lower(coalesce(t.business_name, '')), t.id
        LIMIT ${opts.limit} OFFSET ${(opts.page - 1) * opts.limit}`,
  );
  const [t] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM users t WHERE ${where}`);
  return {
    total: Number(t?.n ?? 0),
    rows: rows.map((r) => ({
      id: r.id,
      businessName: partyLabel(r.business_name, targetRole, r.id),
      city: r.city,
      linkId: r.link_id,
      linkStatus: r.link_status,
      linkRevokedBy: r.revoked_by,
    })),
  };
}

export const listProviderDirectory = (db: Db, actor: User, opts: { q?: string; page: number; limit: number }) =>
  directory(db, actor, "PROVIDER", opts);

export const listDistributorDirectory = (db: Db, actor: User, opts: { q?: string; page: number; limit: number }) =>
  directory(db, actor, "DISTRIBUTOR", opts);

/** Providers ACTIVE-linked to `distributorId`. The caller (a customer) must itself hold an ACTIVE link to that distributor. */
export async function listDistributorProviders(db: Db, actor: User, distributorId: string): Promise<PartyRow[]> {
  const [gate] = await db.all<{ ok: number }>(sql`SELECT (${activeLink(distributorId, actor.id)}) AS ok`);
  if (!gate?.ok) throw new AppError("NOT_LINKED", "You are not linked to this distributor", 403);
  const rows = await db.all<{ id: string; business_name: string | null; city: string | null }>(
    sql`SELECT p.id AS id, p.business_name AS business_name, p.city AS city
        FROM links l JOIN users p ON p.id = l.upper_id AND p.status = 'ACTIVE'
        WHERE l.lower_id = ${distributorId} AND l.kind = 'PROVIDER_DISTRIBUTOR' AND l.status = 'ACTIVE'
        ORDER BY lower(coalesce(p.business_name, '')), p.id LIMIT 200`,
  );
  return rows.map((r) => ({ id: r.id, businessName: partyLabel(r.business_name, "PROVIDER", r.id), city: r.city }));
}
