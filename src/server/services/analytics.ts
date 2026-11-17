import { sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { AppError } from "../errors";
import type { OrderStatus, User } from "../db/schema";
import { partyLabel } from "./party-label";

/**
 * Admin analytics (PRD S8). Read-only, ADMIN only (routes enforce; the service re-checks the role).
 * Money is integer paise (CAST before SUM: libsql binds JS numbers as REAL, see V16). Qty is integer kg.
 * Sales = customer invoices with status PAID. Tonnes from a provider = POs that are neither DRAFT nor REJECTED.
 */

/** Providers listed per distributor; the distributor's orderedKg always covers all providers. */
export const PROVIDERS_PER_DISTRIBUTOR_CAP = 50;
export const CUSTOMER_ORDERS_MAX = 50;

function assertAdmin(actor: Pick<User, "role">): void {
  if (actor.role !== "ADMIN") throw new AppError("FORBIDDEN", "Not allowed", 403);
}
export interface Page { page: number; limit: number }
const clampLimit = (limit: number, max = 50) => Math.max(1, Math.min(limit, max));
/** One clamped limit feeds both LIMIT and OFFSET. */
function window(p: Page, max = 50): { limit: number; offset: number } {
  const limit = clampLimit(p.limit, max);
  return { limit, offset: (Math.max(1, p.page) - 1) * limit };
}

export interface ProviderTonnes { providerId: string; provider: string; qtyKg: number; poCount: number }
export interface DistributorAnalytics {
  distributorId: string;
  distributor: string;
  city: string | null;
  salesPaise: number;
  paidInvoiceCount: number;
  /** Tonnes (kg) over ALL providers, regardless of the providers list cap. */
  orderedKg: number;
  providers: ProviderTonnes[];
  providersTruncated: boolean;
}
export interface DistributorAnalyticsResult {
  rows: DistributorAnalytics[];
  total: number;
  /** Platform-wide across ALL distributors (including revoked/pending); rows are ACTIVE distributors only. */
  totals: { salesPaise: number; orderedKg: number };
}

interface DistributorRaw {
  id: string; business_name: string | null; city: string | null;
  sales: number; paid_n: number; ordered_kg: number; provider_n: number;
}
interface ProviderRaw { did: string; pid: string; business_name: string | null; kg: number; n: number }

export async function getDistributorAnalytics(
  db: Db, actor: Pick<User, "role">, p: Page, providerCap = PROVIDERS_PER_DISTRIBUTOR_CAP,
): Promise<DistributorAnalyticsResult> {
  assertAdmin(actor);
  const w = window(p);
  const dists = await db.all<DistributorRaw>(sql`SELECT u.id, u.business_name, u.city,
      COALESCE((SELECT SUM(CAST(ci.amount_paise AS INTEGER)) FROM customer_invoices ci
        WHERE ci.distributor_id = u.id AND ci.status = 'PAID'), 0) AS sales,
      (SELECT count(*) FROM customer_invoices ci
        WHERE ci.distributor_id = u.id AND ci.status = 'PAID') AS paid_n,
      COALESCE((SELECT SUM(CAST(po.qty_kg AS INTEGER)) FROM purchase_orders po
        WHERE po.distributor_id = u.id AND po.status NOT IN ('DRAFT','REJECTED')), 0) AS ordered_kg,
      (SELECT count(DISTINCT po.provider_id) FROM purchase_orders po
        WHERE po.distributor_id = u.id AND po.status NOT IN ('DRAFT','REJECTED')) AS provider_n
    FROM users u WHERE u.role = 'DISTRIBUTOR' AND u.status = 'ACTIVE'
    ORDER BY sales DESC, u.id LIMIT ${w.limit} OFFSET ${w.offset}`);
  const [cnt] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM users WHERE role = 'DISTRIBUTOR' AND status = 'ACTIVE'`);
  const [tot] = await db.all<{ sales: number | null; kg: number | null }>(sql`SELECT
    (SELECT SUM(CAST(amount_paise AS INTEGER)) FROM customer_invoices WHERE status = 'PAID') AS sales,
    (SELECT SUM(CAST(qty_kg AS INTEGER)) FROM purchase_orders WHERE status NOT IN ('DRAFT','REJECTED')) AS kg`);

  const byDist = new Map<string, ProviderTonnes[]>();
  if (dists.length > 0) {
    const ids = sql.join(dists.map((d) => sql`${d.id}`), sql`, `);
    const prov = await db.all<ProviderRaw>(sql`SELECT did, pid, business_name, kg, n FROM (
        SELECT g.did, g.pid, u.business_name, g.kg, g.n,
          ROW_NUMBER() OVER (PARTITION BY g.did ORDER BY g.kg DESC, g.pid) AS rn
        FROM (SELECT po.distributor_id AS did, po.provider_id AS pid,
            SUM(CAST(po.qty_kg AS INTEGER)) AS kg, count(*) AS n
          FROM purchase_orders po
          WHERE po.distributor_id IN (${ids}) AND po.status NOT IN ('DRAFT','REJECTED')
          GROUP BY po.distributor_id, po.provider_id) g
        JOIN users u ON u.id = g.pid) ranked
      WHERE rn <= ${providerCap} ORDER BY did, rn`);
    for (const r of prov) {
      const list = byDist.get(r.did) ?? [];
      const item = { providerId: r.pid, provider: partyLabel(r.business_name, "PROVIDER", r.pid), qtyKg: Number(r.kg), poCount: Number(r.n) };
      byDist.set(r.did, [...list, item]);
    }
  }
  const rows = dists.map((d) => ({
    distributorId: d.id,
    distributor: partyLabel(d.business_name, "DISTRIBUTOR", d.id),
    city: d.city,
    salesPaise: Number(d.sales),
    paidInvoiceCount: Number(d.paid_n),
    orderedKg: Number(d.ordered_kg),
    providers: byDist.get(d.id) ?? [],
    providersTruncated: Number(d.provider_n) > providerCap,
  }));
  return { rows, total: Number(cnt?.n ?? 0), totals: { salesPaise: Number(tot?.sales ?? 0), orderedKg: Number(tot?.kg ?? 0) } };
}

export interface DispatchRow {
  id: string;
  poId: string;
  dispatchDate: string;
  vehicleNo: string | null;
  driverPhone: string | null;
  qtyKg: number | null;
  distributorId: string;
  distributor: string;
  providerId: string;
  provider: string;
}

interface DispatchRaw {
  id: string; po_id: string; dispatch_date: string; vehicle_no: string | null; driver_phone: string | null; qty_kg: number | null;
  did: string; d_business: string | null; pid: string; p_business: string | null;
}
const DISPATCH_FROM = sql`FROM dispatches x
    JOIN purchase_orders po ON po.id = x.po_id
    JOIN users d ON d.id = x.distributor_id
    JOIN users pr ON pr.id = x.provider_id`;

export async function listAdminDispatches(db: Db, actor: Pick<User, "role">, p: Page): Promise<{ rows: DispatchRow[]; total: number }> {
  assertAdmin(actor);
  const w = window(p);
  const rows = await db.all<DispatchRaw>(sql`SELECT x.id, x.po_id, x.dispatch_date, x.vehicle_no, x.driver_phone, po.qty_kg,
      x.distributor_id AS did, d.business_name AS d_business, x.provider_id AS pid, pr.business_name AS p_business
    ${DISPATCH_FROM}
    ORDER BY x.dispatch_date DESC, x.created_at DESC, x.id DESC LIMIT ${w.limit} OFFSET ${w.offset}`);
  const [t] = await db.all<{ n: number }>(sql`SELECT count(*) AS n ${DISPATCH_FROM}`);
  return {
    total: Number(t?.n ?? 0),
    rows: rows.map((r) => ({
      id: r.id, poId: r.po_id, dispatchDate: r.dispatch_date, vehicleNo: r.vehicle_no, driverPhone: r.driver_phone,
      qtyKg: r.qty_kg === null ? null : Number(r.qty_kg),
      distributorId: r.did, distributor: partyLabel(r.d_business, "DISTRIBUTOR", r.did),
      providerId: r.pid, provider: partyLabel(r.p_business, "PROVIDER", r.pid),
    })),
  };
}

export interface AdminCustomerRow { customerId: string; customer: string; city: string | null; orderCount: number; orderedKg: number }

interface CustomerRaw { id: string; business_name: string | null; name: string; city: string | null; n: number; kg: number }

/** Customers with order count and tonnes ordered (REJECTED and CANCELLED orders excluded from tonnes, included in count). */
export async function listAdminCustomers(db: Db, actor: Pick<User, "role">, p: Page): Promise<{ rows: AdminCustomerRow[]; total: number }> {
  assertAdmin(actor);
  const w = window(p);
  const rows = await db.all<CustomerRaw>(sql`SELECT u.id, u.business_name, u.name, u.city,
      (SELECT count(*) FROM orders o WHERE o.customer_id = u.id) AS n,
      COALESCE((SELECT SUM(CAST(o.qty_kg AS INTEGER)) FROM orders o
        WHERE o.customer_id = u.id AND o.status NOT IN ('REJECTED','CANCELLED')), 0) AS kg
    FROM users u WHERE u.role = 'CUSTOMER'
    ORDER BY u.created_at DESC, u.id DESC LIMIT ${w.limit} OFFSET ${w.offset}`);
  const [t] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM users WHERE role = 'CUSTOMER'`);
  return {
    total: Number(t?.n ?? 0),
    rows: rows.map((r) => ({
      customerId: r.id, customer: partyLabel(r.business_name, "CUSTOMER", r.id, r.name),
      city: r.city, orderCount: Number(r.n), orderedKg: Number(r.kg),
    })),
  };
}

export interface AdminCustomerOrder {
  orderId: string; status: OrderStatus; qtyKg: number; distributorId: string; distributor: string; createdAt: number; neededBy: string;
}
export interface AdminCustomerDetail {
  customerId: string; customer: string; city: string | null; email: string; orders: AdminCustomerOrder[]; total: number;
}

interface CustomerHeaderRaw { id: string; business_name: string | null; name: string; city: string | null; email: string }
interface CustomerOrderRaw {
  id: string; status: OrderStatus; qty_kg: number; did: string; d_business: string | null; created_at: number; needed_by: string;
}

export async function getAdminCustomer(db: Db, actor: Pick<User, "role">, customerId: string, p: Page): Promise<AdminCustomerDetail> {
  assertAdmin(actor);
  const [u] = await db.all<CustomerHeaderRaw>(sql`SELECT id, business_name, name, city, email
    FROM users WHERE id = ${customerId} AND role = 'CUSTOMER'`);
  if (!u) throw new AppError("NOT_FOUND", "Customer not found", 404);
  const w = window(p, CUSTOMER_ORDERS_MAX);
  const rows = await db.all<CustomerOrderRaw>(sql`SELECT o.id, o.status, o.qty_kg, o.distributor_id AS did,
      d.business_name AS d_business, o.created_at, o.needed_by
    FROM orders o JOIN users d ON d.id = o.distributor_id WHERE o.customer_id = ${customerId}
    ORDER BY o.created_at DESC, o.id DESC LIMIT ${w.limit} OFFSET ${w.offset}`);
  const [t] = await db.all<{ n: number }>(sql`SELECT count(*) AS n FROM orders WHERE customer_id = ${customerId}`);
  return {
    customerId: u.id, customer: partyLabel(u.business_name, "CUSTOMER", u.id, u.name),
    city: u.city, email: u.email, total: Number(t?.n ?? 0),
    orders: rows.map((r) => ({
      orderId: r.id, status: r.status, qtyKg: Number(r.qty_kg), distributorId: r.did,
      distributor: partyLabel(r.d_business, "DISTRIBUTOR", r.did), createdAt: Number(r.created_at), neededBy: r.needed_by,
    })),
  };
}
