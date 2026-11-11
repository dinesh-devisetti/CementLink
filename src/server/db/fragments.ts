import { sql, type SQL } from "drizzle-orm";

/** Reusable SQL predicates (ADR-001 rev 2, section 5 "Derived terms"). Table names are fixed identifiers. */

/** `users` row with this id exists and is ACTIVE. */
export function activeUser(userId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM users WHERE id = ${userId} AND status = 'ACTIVE')`;
}

/** Link ACTIVE between upper and lower, and both users ACTIVE. */
export function activeLink(upperId: string, lowerId: string): SQL {
  return sql`EXISTS (SELECT 1 FROM links l
    JOIN users u ON u.id = l.upper_id AND u.status = 'ACTIVE'
    JOIN users d ON d.id = l.lower_id AND d.status = 'ACTIVE'
    WHERE l.upper_id = ${upperId} AND l.lower_id = ${lowerId} AND l.status = 'ACTIVE')`;
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
