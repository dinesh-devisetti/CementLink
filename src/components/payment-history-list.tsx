import { formatPaise } from "@/lib/money";
import type { PaymentHistoryView } from "@/server/services/payments";

const LABEL = { CREATED: "Started", AUTHORIZED: "Confirming", PAID: "Paid", FAILED: "Failed" } as const;

export function PaymentHistoryList({ rows, total }: { rows: PaymentHistoryView[]; total: number }) {
  if (rows.length === 0) return <p className="rounded-card border border-border bg-surface p-4 text-sm">No payments yet. Pay an invoice from the Invoices tab.</p>;
  return (
    <div className="space-y-2">
      <ul aria-label="Payment history" className="space-y-2">
        {rows.map((p) => (
          <li key={p.id} className="rounded-input border border-border bg-surface p-3 text-sm" data-testid="payment-row">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold tabular-nums">{formatPaise(p.amountPaise)}</p>
              <p className="font-semibold">{LABEL[p.status]}</p>
            </div>
            <p className="text-muted">{new Date(p.createdAt + 330 * 60_000).toISOString().slice(0, 10)} - {p.distributor} - invoice {p.invoiceNo}</p>
            {p.razorpayPaymentId && <p className="text-muted">Ref {p.razorpayPaymentId}</p>}
          </li>
        ))}
      </ul>
      {total > rows.length && <p className="text-sm text-muted">Showing the newest {rows.length} of {total}.</p>}
    </div>
  );
}
