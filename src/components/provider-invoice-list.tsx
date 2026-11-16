import Link from "next/link";
import { formatPaise } from "@/lib/money";
import { formatTonnes } from "@/lib/qty";
import type { ProviderInvoiceView } from "@/server/services/provider-invoices";

/** Read-only invoice rows (provider history and distributor view). Server-renderable. `poHref` links each row to its PO. */
export function ProviderInvoiceList({ rows, total, empty = "No invoices yet.", poHref }: { rows: ProviderInvoiceView[]; total?: number; empty?: string; poHref?: (poId: string) => string }) {
  if (rows.length === 0) return <p className="rounded-card border border-border bg-surface p-4 text-sm">{empty}</p>;
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {rows.map((i) => (
          <li key={i.id} className="rounded-input border border-border bg-surface p-3 text-sm" data-testid="invoice-row">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold">{i.invoiceNo}</p>
              <p className="tabular-nums">{i.invoiceDate}</p>
            </div>
            <p className="text-muted">{i.counterparty}</p>
            <p className="tabular-nums">
              {formatTonnes(i.qtyKg)} at {formatPaise(i.ratePerTonnePaise)}/t = {formatPaise(i.amountPaise)} ({i.status === "PAID" ? "Paid" : "Unpaid"})
            </p>
            {poHref && <Link href={poHref(i.poId)} aria-label={`View purchase order for invoice ${i.invoiceNo}`} className="inline-flex min-h-11 items-center font-semibold text-primary">View purchase order</Link>}
          </li>
        ))}
      </ul>
      {total !== undefined && rows.length < total && <p className="text-sm text-muted">Showing the latest {rows.length} of {total} invoices.</p>}
    </div>
  );
}
