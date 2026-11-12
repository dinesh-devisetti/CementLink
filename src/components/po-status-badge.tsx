import { CheckCircle2, Clock, FileText, PencilLine, Truck, XCircle } from "lucide-react";
import type { PoStatus } from "@/server/db/schema";
import { cn } from "./ui";

const BADGE: Record<PoStatus, { label: string; cls: string; Icon: typeof Clock }> = {
  DRAFT: { label: "Draft", cls: "border-dashed border-border text-muted", Icon: PencilLine },
  PLACED: { label: "Placed", cls: "border-info text-info", Icon: FileText },
  ACCEPTED: { label: "Accepted", cls: "border-primary text-primary", Icon: CheckCircle2 },
  REJECTED: { label: "Rejected", cls: "border-danger text-danger", Icon: XCircle },
  DISPATCHED: { label: "Dispatched", cls: "border-primary text-primary", Icon: Truck },
  INVOICED: { label: "Invoiced", cls: "border-warning text-warning", Icon: FileText },
  PAID: { label: "Paid", cls: "border-success text-success", Icon: CheckCircle2 },
};

/** Icon + text + colour, never colour alone. */
export function PoStatusBadge({ status }: { status: PoStatus }) {
  const { label, cls, Icon } = BADGE[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-input border px-2 py-0.5 text-xs font-semibold", cls)}>
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {label}
    </span>
  );
}
