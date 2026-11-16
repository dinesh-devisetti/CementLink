import { CheckCircle2, FileText, Send } from "lucide-react";
import type { CustomerInvoiceStatus } from "@/server/services/customer-invoices";
import { cn } from "./ui";

const BADGE: Record<CustomerInvoiceStatus, { label: string; cls: string; Icon: typeof FileText }> = {
  ISSUED: { label: "Issued", cls: "border-border text-muted", Icon: FileText },
  PAYMENT_REQUESTED: { label: "Payment requested", cls: "border-warning text-warning", Icon: Send },
  PAID: { label: "Paid", cls: "border-success text-success", Icon: CheckCircle2 },
};

export function CustomerInvoiceBadge({ status }: { status: CustomerInvoiceStatus }) {
  const { label, cls, Icon } = BADGE[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-input border px-2 py-0.5 text-xs font-semibold", cls)}>
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}
