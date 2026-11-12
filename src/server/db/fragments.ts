import { sql, type SQL } from "drizzle-orm";

/** Reusable SQL predicates (ADR-001 rev 2, section 5 "Derived terms"). Table names are fixed identifiers. */

/** `users` row with this id exists and is ACTIVE. */
export function activeUser(userId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM users WHERE id = ${userId} AND status = 'ACTIVE')`;
}

export type LinkKindName = "PROVIDER_DISTRIBUTOR" | "DISTRIBUTOR_CUSTOMER";

/** Link ACTIVE between upper and lower, and both users ACTIVE. Pass `kind` to also require the link kind. Ids may be SQL column references. */
export function activeLink(upperId: string | SQL, lowerId: string | SQL, kind?: LinkKindName): SQL {
  const k = kind ? sql` AND l.kind = ${kind}` : sql``;
  const up = typeof upperId === "string" ? sql`${upperId}` : upperId;
  const lo = typeof lowerId === "string" ? sql`${lowerId}` : lowerId;
  return sql`EXISTS (SELECT 1 FROM links l
    JOIN users u ON u.id = l.upper_id AND u.status = 'ACTIVE'
    JOIN users d ON d.id = l.lower_id AND d.status = 'ACTIVE'
    WHERE l.upper_id = ${up} AND l.lower_id = ${lo} AND l.status = 'ACTIVE'${k})`;
}

/** SQL expression: a po_items row (alias `i`) whose PO is not REJECTED. Use inside a FROM po_items i. */
export function liveItem(itemAlias = "i"): SQL {
  const a = sql.raw(itemAlias.replace(/[^A-Za-z0-9_]/g, ""));
  return sql`EXISTS (SELECT 1 FROM purchase_orders p WHERE p.id = ${a}.po_id AND p.status <> 'REJECTED')`;
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
