import { formatPaise } from "@/lib/money";
import { formatTonnes } from "@/lib/qty";
import type { PoView } from "@/server/services/pos";
import type { PoInvoicing } from "@/server/services/provider-invoices";
import { PoStatusBadge } from "./po-status-badge";
import { ProviderInvoiceList } from "./provider-invoice-list";
import { TransportDetails } from "./transport-details";

/** Read-only PO for the distributor: status, provider, rate, reject reason and transport details. */
export function DistributorPoView({ po, invoicing }: { po: PoView; invoicing?: PoInvoicing }) {
  return (
    <div className="space-y-4">
      <section className="space-y-2 rounded-card border border-border bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xl font-semibold tabular-nums">{formatTonnes(po.qtyKg)}</p>
          <PoStatusBadge status={po.status} />
        </div>
        <p className="text-sm text-muted">{po.providerName ?? "No provider yet"}</p>
        {po.ratePerTonnePaise !== null && <p className="text-sm">Rate {formatPaise(po.ratePerTonnePaise)} / t{po.totalPaise !== null ? `, total ${formatPaise(po.totalPaise)}` : ""}</p>}
        {po.rejectReason && <p className="text-sm text-danger">Rejected by provider: {po.rejectReason}</p>}
      </section>
      <TransportDetails dispatch={po.dispatch} />
      {invoicing && invoicing.invoiceCount > 0 && (
        <section aria-label="Provider invoices" className="space-y-2">
          <h2 className="text-xl font-semibold">Provider invoices ({invoicing.invoiceCount})</h2>
          <ProviderInvoiceList rows={invoicing.invoices} total={invoicing.invoiceCount} />
        </section>
      )}
      <section aria-label="Items" className="space-y-2">
        <h2 className="text-xl font-semibold">Orders</h2>
        <ul className="space-y-2">
          {po.items.map((i) => (
            <li key={i.orderId} className="rounded-card border border-border bg-surface p-4">
              <p className="font-semibold">{i.customerName}: <span className="tabular-nums">{formatTonnes(i.qtyKg)}</span></p>
              <p className="text-sm text-muted">Order #{i.orderId.slice(-4)}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
