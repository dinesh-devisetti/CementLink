import Link from "next/link";
import { formatTonnes } from "@/lib/qty";
import type { OrderDetail } from "@/server/services/orders";
import type { PoView } from "@/server/services/pos";
import { CustomerInvoiceForm } from "./customer-invoice-form";
import { OrderInvoiceSection } from "./order-invoice-section";
import { DraftPanel } from "./draft-panel";
import type { ProviderOption } from "./draft-card";
import { DeliverOrderButton } from "./deliver-order-button";
import { OpenOrderOnMount } from "./open-order-on-mount";
import { OrderStatusBadge } from "./order-status-badge";
import { PoStatusBadge } from "./po-status-badge";
import { RejectOrderForm } from "./reject-order-form";

/** Distributor order page: delivery details, auto-open of a REQUESTED order, the draft panel and the placed POs. */
export function DistributorOrderView({ order, drafts, providers, deliveredOn, today }: { order: OrderDetail; drafts: PoView[]; providers: ProviderOption[]; deliveredOn?: string; today?: string }) {
  const placed = order.pos.filter((p) => p.status !== "DRAFT");
  return (
    <div className="space-y-4">
      <section className="space-y-2 rounded-card border border-border bg-surface p-4">
        <div className="flex items-start justify-between gap-3">
          <p className="text-xl font-semibold">{formatTonnes(order.qtyKg)}</p>
          <OrderStatusBadge status={order.status} />
        </div>
        <p className="text-sm text-muted">{order.customerName}, needed by {order.neededBy}</p>
        <p className="text-sm">{order.address}, {order.city} {order.pincode}</p>
        {order.rejectReason && <p className="text-sm text-danger">Reason: {order.rejectReason}</p>}
      </section>
      {order.status === "REQUESTED" && (
        <>
          <OpenOrderOnMount orderId={order.id} />
          <RejectOrderForm orderId={order.id} />
        </>
      )}
      {order.status === "UNDER_REVIEW" && (
        <>
          <DraftPanel drafts={drafts} providers={providers} />
          {placed.length === 0 && <RejectOrderForm orderId={order.id} />}
        </>
      )}
      {placed.length > 0 && (
        <section aria-label="Purchase orders" className="space-y-2 rounded-card border border-border bg-surface p-4">
          <h2 className="text-xl font-semibold">Purchase orders</h2>
          <ul className="space-y-1">
            {placed.map((p) => (
              <li key={p.poId} className="flex items-center justify-between gap-3">
                <span>
                  <Link href={`/distributor/pos/${p.poId}`} className="underline">{p.providerName} <span className="tabular-nums">{formatTonnes(p.qtyKg)}</span></Link>
                  {p.dispatchDate && <span className="block text-sm text-muted">Dispatched {p.dispatchDate}{p.vehicleNo ? `, vehicle ${p.vehicleNo}` : ""}</span>}
                </span>
                <PoStatusBadge status={p.status} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {order.status === "DISPATCHED" && <DeliverOrderButton orderId={order.id} />}
      {order.status === "DELIVERED" && deliveredOn && today && <CustomerInvoiceForm orderId={order.id} qtyKg={order.qtyKg} deliveredOn={deliveredOn} today={today} />}
      <OrderInvoiceSection chain={order.chain} role="DISTRIBUTOR" />
    </div>
  );
}
