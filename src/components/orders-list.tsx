import Link from "next/link";
import { formatTonnes } from "@/lib/qty";
import type { OrderSummary } from "@/server/services/orders";
import { OrderStatusBadge } from "./order-status-badge";

/** Order cards (mobile first). Customers link to the detail page; the distributor list is read only until V13. */
export function OrdersList({ orders, total, role }: { orders: OrderSummary[]; total: number; role: "CUSTOMER" | "DISTRIBUTOR" }) {
  if (orders.length === 0) {
    return (
      <p className="rounded-card border border-border bg-surface p-4">
        {role === "CUSTOMER" ? "No orders yet. Start with New order." : "No customer orders yet."}
      </p>
    );
  }
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {orders.map((o) => {
          const body = (
            <>
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold">
                  {formatTonnes(o.qtyKg)}
                  <span className="font-normal text-muted"> - {role === "CUSTOMER" ? o.distributorName : o.customerName}</span>
                </p>
                <OrderStatusBadge status={o.status} />
              </div>
              <p className="text-sm text-muted">
                {o.city}, needed by {o.neededBy}
                {o.choiceKg > 0 ? `, ${formatTonnes(o.choiceKg)} distributor's choice` : ""}
              </p>
            </>
          );
          return (
            <li key={o.id} className="rounded-card border border-border bg-surface p-4">
              {role === "CUSTOMER" ? (
                <Link href={`/customer/orders/${o.id}`} className="block space-y-1">
                  {body}
                </Link>
              ) : (
                <div className="space-y-1">{body}</div>
              )}
            </li>
          );
        })}
      </ul>
      {orders.length < total && <p className="text-sm text-muted">Showing the latest {orders.length} of {total} orders.</p>}
    </div>
  );
}
