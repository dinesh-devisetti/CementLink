import { sql, type SQL } from "drizzle-orm";

/** Reusable SQL predicates (ADR-001 rev 2, section 5 "Derived terms"). Table names are fixed identifiers. */

/** `users` row with this id exists and is ACTIVE. */
export function activeUser(userId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM users WHERE id = ${userId} AND status = 'ACTIVE')`;
}

export type LinkKindName = "PROVIDER_DISTRIBUTOR" | "DISTRIBUTOR_CUSTOMER";

/**
 * Link ACTIVE between upper and lower, and both users ACTIVE. Pass `kind` to also require the link kind. Ids may be SQL column references.
 *
 * ALIAS CAPTURE WARNING: the id arguments are spliced into a subquery. If a caller passes a SQL reference such as
 * sql`u.id` or sql`l.upper_id`, any alias the subquery itself declares would shadow the caller's table and silently
 * change the meaning. The inner aliases are therefore namespaced (al_l, al_u, al_d); never pick an outer alias with
 * that prefix. The same rule applies to liveItem (li_p).
 */
export function activeLink(upperId: string | SQL, lowerId: string | SQL, kind?: LinkKindName): SQL {
  const k = kind ? sql` AND al_l.kind = ${kind}` : sql``;
  const up = typeof upperId === "string" ? sql`${upperId}` : upperId;
  const lo = typeof lowerId === "string" ? sql`${lowerId}` : lowerId;
  return sql`EXISTS (SELECT 1 FROM links al_l
    JOIN users al_u ON al_u.id = al_l.upper_id AND al_u.status = 'ACTIVE'
    JOIN users al_d ON al_d.id = al_l.lower_id AND al_d.status = 'ACTIVE'
    WHERE al_l.upper_id = ${up} AND al_l.lower_id = ${lo} AND al_l.status = 'ACTIVE'${k})`;
}

/** SQL expression: a po_items row (alias `i`) whose PO is not REJECTED. Use inside a FROM po_items i. Inner alias is li_p (see activeLink's alias-capture warning). */
export function liveItem(itemAlias = "i"): SQL {
  const a = sql.raw(itemAlias.replace(/[^A-Za-z0-9_]/g, ""));
  return sql`EXISTS (SELECT 1 FROM purchase_orders li_p WHERE li_p.id = ${a}.po_id AND li_p.status <> 'REJECTED')`;
}

/** SQL expression converting an epoch-ms column or expression to an IST YYYY-MM-DD string. */
export function istDate(msExpr: SQL): SQL {
  return sql`date((${msExpr}) / 1000 + 19800, 'unixepoch')`;
}

/**
 * Link row (alias `l`) that was ACTIVE at some point before being revoked. Cancelled requests are also REVOKED
 * but have revoked_by NULL, so "ACTIVE or REVOKED" views must use `status = 'ACTIVE' OR (status = 'REVOKED' AND wasActive(l))`.
 */
export function wasActive(linkAlias = "l"): SQL {
  const a = sql.raw(linkAlias.replace(/[^A-Za-z0-9_]/g, ""));
  return sql`${a}.revoked_by IS NOT NULL`;
}
