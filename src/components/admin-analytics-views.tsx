import Link from "next/link";
import { NO_FILTERS, SEARCH_MAX, type AnalyticsFilters } from "@/lib/validation/admin-analytics";
import { formatPaise } from "@/lib/money";
import { formatTonnes } from "@/lib/qty";
import type { AdminCustomerDetail, AdminCustomerRow, DispatchRow, DistributorAnalyticsResult } from "@/server/services/analytics";
import { OrderStatusBadge } from "./order-status-badge";

const box = "rounded-card border border-border bg-surface p-4";
const empty = (t: string) => <p className={box}>{t}</p>;

function pageHref(base: string, page: number, f: AnalyticsFilters): string {
  const sp = new URLSearchParams();
  if (f.q) sp.set("q", f.q);
  if (f.from) sp.set("from", f.from);
  if (f.to) sp.set("to", f.to);
  if (page > 1) sp.set("page", String(page));
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}

/** GET form: search + IST date range. Submitting resets to page 1. */
export function FilterBar({ base, filters, searchLabel }: { base: string; filters: AnalyticsFilters; searchLabel: string }) {
  const input = "min-h-11 rounded-card border border-border bg-surface px-3";
  return (
    <form method="get" action={base} role="search" aria-label="Filters" className={`${box} flex flex-wrap items-end gap-3 text-sm`}>
      <label className="flex min-w-48 flex-1 flex-col gap-1">{searchLabel}
        <input type="search" name="q" defaultValue={filters.q ?? ""} maxLength={SEARCH_MAX} className={input} /></label>
      <label className="flex flex-col gap-1">From (IST)<input type="date" name="from" defaultValue={filters.from ?? ""} className={input} /></label>
      <label className="flex flex-col gap-1">To (IST)<input type="date" name="to" defaultValue={filters.to ?? ""} className={input} /></label>
      <button type="submit" className="min-h-11 rounded-card bg-primary px-4 font-semibold text-white">Apply</button>
      {(filters.q || filters.from || filters.to) && <Link href={base} className="inline-flex min-h-11 items-center font-semibold text-primary">Clear</Link>}
    </form>
  );
}

/** Prev/Next links for server-paginated admin lists (?page=), keeping the active filters. */
export function Pager({ base, page, limit, total, filters = NO_FILTERS }: { base: string; page: number; limit: number; total: number; filters?: AnalyticsFilters }) {
  const last = Math.max(1, Math.ceil(total / limit));
  if (page > last) {
    return <Link href={pageHref(base, last, filters)} className="inline-flex min-h-11 items-center font-semibold text-primary">Go to last page ({last})</Link>;
  }
  if (last === 1) return null;
  return (
    <nav aria-label="Pagination" className="flex items-center justify-between text-sm">
      {page > 1 ? <Link href={pageHref(base, page - 1, filters)} className="inline-flex min-h-11 items-center font-semibold text-primary">Previous</Link> : <span />}
      <span className="tabular-nums text-muted">Page {page} of {last}</span>
      {page < last ? <Link href={pageHref(base, page + 1, filters)} className="inline-flex min-h-11 items-center font-semibold text-primary">Next</Link> : <span />}
    </nav>
  );
}

export function DistributorAnalyticsView({ data }: { data: DistributorAnalyticsResult }) {
  return (
    <div className="space-y-4">
      <section aria-label="Platform totals" className={`${box} grid grid-cols-2 gap-2`}>
        <div><p className="text-xs text-muted">Paid sales</p><p className="text-2xl font-semibold tabular-nums" data-testid="total-sales">{formatPaise(data.totals.salesPaise)}</p></div>
        <div><p className="text-xs text-muted">Tonnes ordered from providers</p><p className="text-2xl font-semibold tabular-nums" data-testid="total-tonnes">{formatTonnes(data.totals.orderedKg)}</p></div>
      </section>
      {data.rows.length === 0 ? empty("No distributors match.") : (
        <ul className="space-y-2">
          {data.rows.map((d) => (
            <li key={d.distributorId} className={box} data-testid="distributor-row" data-distributor={d.distributor}>
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">{d.distributor}{d.city ? <span className="font-normal text-muted"> - {d.city}</span> : null}</p>
                <p className="tabular-nums" data-testid="sales">{formatPaise(d.salesPaise)}</p>
              </div>
              <p className="text-xs text-muted">Sales from {d.paidInvoiceCount} paid invoice{d.paidInvoiceCount === 1 ? "" : "s"}</p>
              {d.providers.length === 0 ? <p className="mt-2 text-sm text-muted">No placed purchase orders.</p> : (
                <table className="mt-2 w-full text-sm">
                  <caption className="sr-only">Tonnes ordered from each provider by {d.distributor}</caption>
                  <thead><tr className="text-left text-xs text-muted"><th scope="col" className="font-normal">Provider</th><th scope="col" className="text-right font-normal">POs</th><th scope="col" className="text-right font-normal">Tonnes</th></tr></thead>
                  <tbody>
                    {d.providers.map((p) => (
                      <tr key={p.providerId} data-testid="provider-tonnes" data-provider={p.provider}>
                        <td>{p.provider}</td><td className="text-right tabular-nums">{p.poCount}</td><td className="text-right tabular-nums">{formatTonnes(p.qtyKg)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              {d.providersTruncated && <p className="mt-1 text-xs text-muted">Showing the top {d.providers.length} providers; the total above covers all.</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function DispatchTable({ rows }: { rows: DispatchRow[] }) {
  if (rows.length === 0) return empty("No dispatches match.");
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.id} className={`${box} text-sm`} data-testid="dispatch-row" data-po={r.poId}>
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold tabular-nums">{r.dispatchDate}</p>
            <p className="tabular-nums">{r.qtyKg === null ? "-" : formatTonnes(r.qtyKg)}</p>
          </div>
          <p>Vehicle: <span data-testid="vehicle">{r.vehicleNo ?? "Not given"}</span> | Driver: <span data-testid="driver">{r.driverPhone ?? "Not given"}</span></p>
          <p className="text-muted">{r.provider} to {r.distributor}</p>
          <p className="text-xs text-muted">PO #{r.poId.slice(-6)}</p>
        </li>
      ))}
    </ul>
  );
}

export function CustomerTable({ rows }: { rows: AdminCustomerRow[] }) {
  if (rows.length === 0) return empty("No customers match.");
  return (
    <ul className="space-y-2">
      {rows.map((c) => (
        <li key={c.customerId} className={box} data-testid="customer-row">
          <Link href={`/admin/customers/${c.customerId}`} className="inline-flex min-h-11 items-center font-semibold text-primary">{c.customer}</Link>
          <p className="text-sm text-muted">{c.city ?? "No city"} | {c.orderCount} order{c.orderCount === 1 ? "" : "s"} | {formatTonnes(c.orderedKg)} ordered</p>
        </li>
      ))}
    </ul>
  );
}

export function CustomerOrders({ detail }: { detail: AdminCustomerDetail }) {
  return (
    <div className="space-y-2">
      <p className="text-sm text-muted">{detail.email}{detail.city ? ` | ${detail.city}` : ""} | {detail.total} order{detail.total === 1 ? "" : "s"}</p>
      {detail.orders.length === 0 ? empty("No orders yet.") : (
        <ul className="space-y-2">
          {detail.orders.map((o) => (
            <li key={o.orderId} className={`${box} text-sm`} data-testid="customer-order-row">
              <div className="flex items-start justify-between gap-2"><OrderStatusBadge status={o.status} /><p className="tabular-nums">{formatTonnes(o.qtyKg)}</p></div>
              <p className="text-muted">{o.distributor} | needed by {o.neededBy}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
