import { Ban, CheckCircle2, Clock, FileText, PackageCheck, Truck, XCircle } from "lucide-react";
import type { OrderStatus } from "@/server/db/schema";
import { cn } from "./ui";

const BADGE: Record<OrderStatus, { label: string; cls: string; Icon: typeof Clock }> = {
  REQUESTED: { label: "Requested", cls: "border-warning text-warning", Icon: Clock },
  UNDER_REVIEW: { label: "Under review", cls: "border-info text-info", Icon: FileText },
  POS_PLACED: { label: "POs placed", cls: "border-info text-info", Icon: FileText },
  DISPATCHED: { label: "Dispatched", cls: "border-info text-info", Icon: Truck },
  DELIVERED: { label: "Delivered", cls: "border-success text-success", Icon: PackageCheck },
  INVOICED: { label: "Invoiced", cls: "border-info text-info", Icon: FileText },
  PAID: { label: "Paid", cls: "border-success text-success", Icon: CheckCircle2 },
  REJECTED: { label: "Rejected", cls: "border-danger text-danger", Icon: XCircle },
  CANCELLED: { label: "Cancelled", cls: "border-border text-muted", Icon: Ban },
};

/** Icon + text + colour, never colour alone. */
export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const { label, cls, Icon } = BADGE[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-input border px-2 py-0.5 text-xs font-semibold", cls)}>
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}
