import { formatTonnes } from "@/lib/qty";
import type { OrderDetail } from "@/server/services/orders";
import { CancelOrderButton } from "./cancel-order-button";
import { OrderStatusBadge } from "./order-status-badge";
import { PoStatusBadge } from "./po-status-badge";

/** Customer order page: split, remainder, address and (while REQUESTED) cancel. Grows with the document chain in V13+. */
export function OrderDetailView({ order }: { order: OrderDetail }) {
  return (
    <div className="space-y-4">
      <section className="space-y-2 rounded-card border border-border bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xl font-semibold">{formatTonnes(order.qtyKg)}</p>
          <OrderStatusBadge status={order.status} />
        </div>
        <p className="text-sm text-muted">From {order.distributorName}, needed by {order.neededBy}</p>
        <p className="text-sm">{order.address}, {order.city} {order.pincode}</p>
        {order.rejectReason && <p className="text-sm text-danger">Reason: {order.rejectReason}</p>}
      </section>
      <section className="space-y-2 rounded-card border border-border bg-surface p-4">
        <h2 className="text-xl font-semibold">Providers</h2>
        <ul className="space-y-1">
          {order.allocations.map((a) => (
            <li key={a.providerId} className="flex justify-between gap-3">
              <span>{a.providerName}</span>
              <span className="tabular-nums">{formatTonnes(a.qtyKg)}</span>
            </li>
          ))}
          {order.choiceKg > 0 && (
            <li className="flex justify-between gap-3 text-muted">
              <span>Distributor&apos;s choice</span>
              <span className="tabular-nums">{formatTonnes(order.choiceKg)}</span>
            </li>
          )}
        </ul>
      </section>
      {order.pos.length > 0 && (
        <section aria-label="Purchase orders" className="space-y-2 rounded-card border border-border bg-surface p-4">
          <h2 className="text-xl font-semibold">Purchase orders</h2>
          <ul className="space-y-1">
            {order.pos.map((p) => (
              <li key={p.poId} className="flex items-center justify-between gap-3">
                <span>
                  {p.providerName} <span className="tabular-nums">{formatTonnes(p.qtyKg)}</span>
                  {p.dispatchDate && <span className="block text-sm text-muted">Dispatched {p.dispatchDate}{p.vehicleNo ? `, vehicle ${p.vehicleNo}` : ""}</span>}
                </span>
                <PoStatusBadge status={p.status} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {order.status === "REQUESTED" && <CancelOrderButton orderId={order.id} />}
    </div>
  );
}
