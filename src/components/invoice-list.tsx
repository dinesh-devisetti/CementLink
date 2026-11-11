import { formatPaise } from "@/lib/money";
import type { InvoiceView } from "@/server/services/invoices";

/** Read-only invoice rows (provider history and distributor view). Not interactive, so server-renderable. */
export function InvoiceList({ rows, empty = "No invoices yet" }: { rows: InvoiceView[]; empty?: string }) {
  if (rows.length === 0) return <p className="rounded-card border border-border bg-surface p-4 text-sm">{empty}</p>;
  return (
    <ul className="space-y-2">
      {rows.map((i) => (
        <li key={i.id} className="rounded-input border border-border bg-surface p-3 text-sm" data-testid="invoice-row">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold">{i.invoiceNo}</p>
            <p className="tabular-nums">{i.invoiceDate}</p>
          </div>
          <p className="text-muted">{i.counterparty}</p>
          <p className="tabular-nums">
            {i.qtyBags} bags · {formatPaise(i.ratePerBagPaise)}/bag · {formatPaise(i.amountPaise)}
          </p>
        </li>
      ))}
    </ul>
  );
}
