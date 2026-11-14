import { formatPaise } from "@/lib/money";
import { formatTonnes } from "@/lib/qty";
import type { PoView } from "@/server/services/pos";
import { istDate, todayIst } from "@/lib/dates";
import { AcceptRejectPanel, DispatchForm } from "./provider-po-actions";
import { PoStatusBadge } from "./po-status-badge";
import { TransportDetails } from "./transport-details";

/** PO for the provider with accept/reject/dispatch actions: each item with its delivery address and the customer display name (no email or phone). */
export function ProviderPoView({ po }: { po: PoView }) {
  return (
    <div className="space-y-4">
      <section className="space-y-2 rounded-card border border-border bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xl font-semibold tabular-nums">{formatTonnes(po.qtyKg)}</p>
          <PoStatusBadge status={po.status} />
        </div>
        <p className="text-sm text-muted">From {po.distributorName}</p>
        {po.ratePerTonnePaise !== null && <p className="text-sm">Rate {formatPaise(po.ratePerTonnePaise)} / t{po.totalPaise !== null ? `, total ${formatPaise(po.totalPaise)}` : ""}</p>}
        {po.rejectReason && <p className="text-sm text-danger">Reason: {po.rejectReason}</p>}
      </section>
      {po.status === "PLACED" && <AcceptRejectPanel poId={po.id} />}
      {po.status === "ACCEPTED" && <DispatchForm poId={po.id} today={todayIst()} placedOn={istDate(po.placedAt ?? po.createdAt)} />}
      <TransportDetails dispatch={po.dispatch} />
      <section aria-label="Items" className="space-y-2">
        <h2 className="text-xl font-semibold">Deliveries</h2>
        <ul className="space-y-2">
          {po.items.map((i) => (
            <li key={i.orderId} className="space-y-1 rounded-card border border-border bg-surface p-4">
              <p className="font-semibold">{i.customerName}: <span className="tabular-nums">{formatTonnes(i.qtyKg)}</span></p>
              <p className="text-sm">{i.address}, {i.city} {i.pincode}</p>
              <p className="text-sm text-muted">Needed by {i.neededBy}</p>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
