import { sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { AppError } from "../errors";
import { wasActive } from "../db/fragments";
import type { User } from "../db/schema";
import { partyLabel } from "./party-label";

/** Balances (ADR-001 7): provider outstanding per distributor, and the distributor's mirror payable per provider. Integer paise only. */

export interface BalanceRow {
  counterpartyId: string;
  counterparty: string;
  invoicedPaise: number;
  paidPaise: number;
  outstandingPaise: number;
}
export interface ReceivableRow { customerId: string; customer: string; invoicedPaise: number; paidPaise: number; toReceivePaise: number }
export interface Receivable {
  /** Customer invoices not yet paid through Razorpay (money to receive). */
  toReceivePaise: number;
  invoicedPaise: number;
  paidPaise: number;
  rows: ReceivableRow[];
}
export interface Balances {
  /** DISTRIBUTOR only: money to receive from customers. */
  receivable?: Receivable;
  /** PROVIDER: money still owed to the provider. DISTRIBUTOR: money still payable to providers. */
  kind: "OUTSTANDING" | "PAYABLE";
  rows: BalanceRow[];
  totalOutstandingPaise: number;
}

const only = (col: SQL, alias: string, id?: string): SQL => (id ? sql` AND ${sql.raw(alias + ".")}${col} = ${id}` : sql``);

interface Raw { other_id: string; other_business: string | null; invoiced: number; paid: number }

export async function getBalances(db: Db, actor: User & { role: string }, counterpartyId?: string): Promise<Balances> {
  if (actor.role !== "PROVIDER" && actor.role !== "DISTRIBUTOR") throw new AppError("FORBIDDEN", "Not allowed", 403);
  const isProvider = actor.role === "PROVIDER";
  const own = sql.raw(isProvider ? "provider_id" : "distributor_id");
  const other = sql.raw(isProvider ? "distributor_id" : "provider_id");
  const rows = await db.all<Raw>(sql`SELECT u.id AS other_id, u.business_name AS other_business, g.invoiced, g.paid
    FROM (SELECT pi.${other} AS oid, SUM(pi.amount_paise) AS invoiced,
        (SELECT COALESCE(SUM(pp.amount_paise), 0) FROM provider_payments pp WHERE pp.${own} = ${actor.id} AND pp.${other} = pi.${other}) AS paid
      FROM provider_invoices pi WHERE pi.${own} = ${actor.id}${only(other, "pi", counterpartyId)} GROUP BY pi.${other}) g
    JOIN users u ON u.id = g.oid ORDER BY (g.invoiced - g.paid) DESC, u.id LIMIT 200`);
  const [tot] = await db.all<{ invoiced: number | null; paid: number | null }>(sql`SELECT
    (SELECT SUM(CAST(pi.amount_paise AS INTEGER)) FROM provider_invoices pi WHERE pi.${own} = ${actor.id}${only(other, "pi", counterpartyId)}) AS invoiced,
    (SELECT SUM(CAST(pp.amount_paise AS INTEGER)) FROM provider_payments pp WHERE pp.${own} = ${actor.id}${only(other, "pp", counterpartyId)}) AS paid`);
  const otherRole = isProvider ? "DISTRIBUTOR" : "PROVIDER";
  const receivable = isProvider || counterpartyId ? undefined : await getReceivable(db, actor);
  const out = rows.map((r) => ({
    counterpartyId: r.other_id,
    counterparty: partyLabel(r.other_business, otherRole, r.other_id),
    invoicedPaise: Number(r.invoiced),
    paidPaise: Number(r.paid),
    outstandingPaise: Number(r.invoiced) - Number(r.paid),
  }));
  return { kind: isProvider ? "OUTSTANDING" : "PAYABLE", rows: out, totalOutstandingPaise: Number(tot?.invoiced ?? 0) - Number(tot?.paid ?? 0), ...(receivable ? { receivable } : {}) };
}

/** Distributor money to receive: customer invoices minus those marked PAID by the Razorpay webhook. Uncapped totals; per-customer rows capped at 200. */
export async function getReceivable(db: Db, actor: User): Promise<Receivable> {
  const rows = await db.all<{ cid: string; c_business: string | null; c_name: string; invoiced: number; paid: number }>(sql`SELECT u.id AS cid, u.business_name AS c_business, u.name AS c_name, g.invoiced, g.paid
    FROM (SELECT ci.customer_id AS cid, SUM(CAST(ci.amount_paise AS INTEGER)) AS invoiced, SUM(CASE WHEN ci.status = 'PAID' THEN CAST(ci.amount_paise AS INTEGER) ELSE 0 END) AS paid
      FROM customer_invoices ci WHERE ci.distributor_id = ${actor.id} GROUP BY ci.customer_id) g
    JOIN users u ON u.id = g.cid ORDER BY (g.invoiced - g.paid) DESC, u.id LIMIT 200`);
  const [t] = await db.all<{ invoiced: number | null; paid: number | null }>(sql`SELECT SUM(CAST(amount_paise AS INTEGER)) AS invoiced,
    SUM(CASE WHEN status = 'PAID' THEN CAST(amount_paise AS INTEGER) ELSE 0 END) AS paid FROM customer_invoices WHERE distributor_id = ${actor.id}`);
  const invoicedPaise = Number(t?.invoiced ?? 0);
  const paidPaise = Number(t?.paid ?? 0);
  return {
    invoicedPaise, paidPaise, toReceivePaise: invoicedPaise - paidPaise,
    rows: rows.map((r) => ({ customerId: r.cid, customer: partyLabel(r.c_business, "CUSTOMER", r.cid, r.c_name), invoicedPaise: Number(r.invoiced), paidPaise: Number(r.paid), toReceivePaise: Number(r.invoiced) - Number(r.paid) })),
  };
}

/** A provider's view of one linked distributor: balance row plus label. 404 unless a link is or was ACTIVE. */
export async function getProviderDistributorHeader(db: Db, actor: User, distributorId: string): Promise<BalanceRow & { city: string | null }> {
  const [u] = await db.all<{ id: string; business_name: string | null; city: string | null }>(sql`SELECT u.id, u.business_name, u.city FROM users u
    WHERE u.id = ${distributorId} AND u.role = 'DISTRIBUTOR' AND (
      EXISTS (SELECT 1 FROM links l WHERE l.upper_id = ${actor.id} AND l.lower_id = u.id AND l.kind = 'PROVIDER_DISTRIBUTOR' AND (l.status = 'ACTIVE' OR (l.status = 'REVOKED' AND ${wasActive("l")}))))`);
  if (!u) throw new AppError("NOT_FOUND", "Distributor not found", 404);
  const b = (await getBalances(db, actor, u.id)).rows[0];
  return { counterpartyId: u.id, counterparty: partyLabel(u.business_name, "DISTRIBUTOR", u.id), city: u.city, invoicedPaise: b?.invoicedPaise ?? 0, paidPaise: b?.paidPaise ?? 0, outstandingPaise: b?.outstandingPaise ?? 0 };
}
