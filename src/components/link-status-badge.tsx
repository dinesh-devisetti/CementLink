import { Ban, CheckCircle2, Clock, XCircle } from "lucide-react";
import type { LinkStatus } from "@/server/db/schema";
import { cn } from "./ui";

const BADGE: Record<LinkStatus, { label: string; cls: string; Icon: typeof Clock }> = {
  PENDING: { label: "Pending", cls: "border-warning text-warning", Icon: Clock },
  ACTIVE: { label: "Active", cls: "border-success text-success", Icon: CheckCircle2 },
  REJECTED: { label: "Rejected", cls: "border-danger text-danger", Icon: XCircle },
  REVOKED: { label: "Revoked", cls: "border-border text-muted", Icon: Ban },
};

/** Icon + text + colour, never colour alone. */
export function LinkStatusBadge({ status, label }: { status: LinkStatus; label?: string }) {
  const { label: text, cls, Icon } = BADGE[status];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-input border px-2 py-0.5 text-xs font-semibold", cls)}>
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {label ?? text}
    </span>
  );
}
