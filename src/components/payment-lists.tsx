import Link from "next/link";
import { formatPaise } from "@/lib/money";
import type { BalanceRow, Balances } from "@/server/services/balances";
import type { InvoiceBalanceView, ProviderPaymentView } from "@/server/services/provider-payments";

/** Read-only money lists shared by the provider and distributor Payments tabs. Server-renderable. */

export function BalanceSummary({ balances, title, empty, href }: { balances: Balances; title: string; empty: string; href?: (r: BalanceRow) => string }) {
  return (
    <section aria-label={title} className="space-y-2 rounded-card border border-border bg-surface p-4">
      <h2 className="text-xl font-semibold">{title}</h2>
      <p className="text-3xl font-semibold tabular-nums" data-testid="balance-total">{formatPaise(balances.totalOutstandingPaise)}</p>
      {balances.rows.length === 0 ? <p className="text-sm text-muted">{empty}</p> : (
        <ul className="space-y-2">
          {balances.rows.map((r) => (
            <li key={r.counterpartyId} className="rounded-input border border-border p-3 text-sm" data-testid="balance-row">
              <p className="font-semibold">{href ? <Link href={href(r)} className="text-primary">{r.counterparty}</Link> : r.counterparty}</p>
              <p className="tabular-nums text-muted">Invoiced {formatPaise(r.invoicedPaise)} - Paid {formatPaise(r.paidPaise)}</p>
              <p className="tabular-nums font-semibold">Outstanding {formatPaise(r.outstandingPaise)}</p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export function ReceiptList({ rows, total, empty, label }: { rows: ProviderPaymentView[]; total?: number; empty: string; label: string }) {
  if (rows.length === 0) return <p className="rounded-card border border-border bg-surface p-4 text-sm">{empty}</p>;
  return (
    <div className="space-y-2">
      <ul className="space-y-2" aria-label={label}>
        {rows.map((p) => (
          <li key={p.id} className="rounded-input border border-border bg-surface p-3 text-sm" data-testid="receipt-row">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold tabular-nums">{formatPaise(p.amountPaise)}</p>
              <p className="tabular-nums">{p.paidOn}</p>
            </div>
            <p className="text-muted">{p.counterparty} - invoice {p.invoiceNo} - {p.mode}{p.reference ? ` - ${p.reference}` : ""}</p>
          </li>
        ))}
      </ul>
      {total !== undefined && rows.length < total && <p className="text-sm text-muted">Showing the latest {rows.length} of {total} payments.</p>}
    </div>
  );
}

export function InvoiceBalanceList({ rows, empty, children }: { rows: InvoiceBalanceView[]; empty: string; children?: (r: InvoiceBalanceView) => React.ReactNode }) {
  if (rows.length === 0) return <p className="rounded-card border border-border bg-surface p-4 text-sm">{empty}</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.id} className="space-y-1 rounded-card border border-border bg-surface p-4 text-sm" data-testid="payable-row">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold">{r.invoiceNo}</p>
            <p className="tabular-nums">{r.invoiceDate}</p>
          </div>
          <p className="text-muted">{r.counterparty}</p>
          <p className="tabular-nums">Amount {formatPaise(r.amountPaise)} - Paid {formatPaise(r.paidPaise)} - <span className="font-semibold">{r.outstandingPaise === 0 ? "Paid in full" : `Outstanding ${formatPaise(r.outstandingPaise)}`}</span></p>
          {children?.(r)}
        </li>
      ))}
    </ul>
  );
}
