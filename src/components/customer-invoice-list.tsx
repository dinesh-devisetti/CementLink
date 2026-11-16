import Link from "next/link";
import { formatPaise } from "@/lib/money";
import { formatTonnes } from "@/lib/qty";
import type { CustomerInvoiceView } from "@/server/services/customer-invoices";
import { CustomerInvoiceBadge } from "./customer-invoice-badge";
import { PayButton } from "./pay-button";
import { SendPaymentRequestButton } from "./send-payment-request-button";

/** Invoice cards. The distributor can send a payment request; the customer can pay once it was requested (full amount only). */
export function CustomerInvoiceList({ rows, total, role, empty }: { rows: CustomerInvoiceView[]; total: number; role: "CUSTOMER" | "DISTRIBUTOR"; empty: string }) {
  if (rows.length === 0) return <p className="rounded-card border border-border bg-surface p-4 text-sm">{empty}</p>;
  const orderHref = (id: string) => `/${role.toLowerCase()}/orders/${id}`;
  return (
    <div className="space-y-2">
      <ul aria-label="Customer invoices" className="space-y-2">
        {rows.map((i) => (
          <li key={i.id} className="space-y-2 rounded-input border border-border bg-surface p-3 text-sm" data-testid="customer-invoice-row">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold">{i.invoiceNo}</p>
              <CustomerInvoiceBadge status={i.status} />
            </div>
            <p className="text-muted">{i.counterparty} - {i.invoiceDate}</p>
            <p className="tabular-nums">{formatTonnes(i.qtyKg)} x {formatPaise(i.ratePerTonnePaise)} / t = <span className="font-semibold">{formatPaise(i.amountPaise)}</span></p>
            {i.needsRefund && <p role="alert" className="rounded-input border border-danger p-2 text-danger" data-testid="needs-refund">Needs refund review: a payment was captured that could not be applied to this invoice. Refund it in the Razorpay dashboard.</p>}
            <Link href={orderHref(i.orderId)} className="text-primary underline">View order</Link>
            {role === "DISTRIBUTOR" && i.status === "ISSUED" && <SendPaymentRequestButton invoiceId={i.id} />}
            {role === "CUSTOMER" && i.status === "PAYMENT_REQUESTED" && <PayButton invoiceId={i.id} amountPaise={i.amountPaise} />}
          </li>
        ))}
      </ul>
      {total > rows.length && <p className="text-sm text-muted">Showing the newest {rows.length} of {total}.</p>}
    </div>
  );
}
