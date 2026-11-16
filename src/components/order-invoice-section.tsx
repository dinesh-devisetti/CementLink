import Link from "next/link";
import { formatPaise } from "@/lib/money";
import { formatTonnes } from "@/lib/qty";
import type { OrderChain } from "@/server/services/customer-invoices";
import { CustomerInvoiceBadge } from "./customer-invoice-badge";
import { PayButton } from "./pay-button";
import { SendPaymentRequestButton } from "./send-payment-request-button";

/** Document-chain tail of an order: customer invoice, then payment (and, for the distributor only, the provider invoices behind it). */
export function OrderInvoiceSection({ chain, role }: { chain: OrderChain; role: "CUSTOMER" | "DISTRIBUTOR" }) {
  const { invoice, payment, providerInvoices } = chain;
  if (!invoice) return null;
  return (
    <section aria-label="Invoice and payment" className="space-y-2 rounded-card border border-border bg-surface p-4">
      <h2 className="text-xl font-semibold">Invoice and payment</h2>
      <div className="flex items-start justify-between gap-3">
        <p className="font-semibold">Customer invoice {invoice.invoiceNo}</p>
        <CustomerInvoiceBadge status={invoice.status} />
      </div>
      <p className="text-sm tabular-nums">{invoice.invoiceDate} - {formatTonnes(invoice.qtyKg)} x {formatPaise(invoice.ratePerTonnePaise)} / t = <span className="font-semibold">{formatPaise(invoice.amountPaise)}</span></p>
      {invoice.needsRefund && <p role="alert" className="rounded-input border border-danger p-2 text-sm text-danger" data-testid="needs-refund">Needs refund review: a payment was captured that could not be applied to this invoice. Refund it in the Razorpay dashboard.</p>}
      {payment && (
        <p className="text-sm" data-testid="payment-chip">
          Payment {payment.razorpayPaymentId ?? "(not yet confirmed)"} - {payment.status === "PAID" ? "Paid" : payment.status === "FAILED" ? "Failed" : "In progress"}
        </p>
      )}
      {role === "DISTRIBUTOR" && providerInvoices.length > 0 && (
        <p className="text-sm text-muted">
          Provider invoices:{" "}
          {providerInvoices.map((p, i) => (
            <span key={p.id}>{i > 0 && ", "}<Link href={`/distributor/pos/${p.poId}`} className="underline">{p.invoiceNo}</Link></span>
          ))}
        </p>
      )}
      {role === "DISTRIBUTOR" && invoice.status === "ISSUED" && <SendPaymentRequestButton invoiceId={invoice.id} />}
      {role === "CUSTOMER" && invoice.status === "PAYMENT_REQUESTED" && <PayButton invoiceId={invoice.id} amountPaise={invoice.amountPaise} />}
    </section>
  );
}
