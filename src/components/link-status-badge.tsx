import { Ban, CheckCircle2, Clock, XCircle } from "lucide-react";
import type { LinkStatus } from "@/server/db/schema";
import { linkStatusLabel } from "@/lib/link-label";
import { cn } from "./ui";

const BADGE: Record<LinkStatus, { cls: string; Icon: typeof Clock }> = {
  PENDING: { cls: "border-warning text-warning", Icon: Clock },
  ACTIVE: { cls: "border-success text-success", Icon: CheckCircle2 },
  REJECTED: { cls: "border-danger text-danger", Icon: XCircle },
  REVOKED: { cls: "border-border text-muted", Icon: Ban },
};

/** Icon + text + colour, never colour alone. */
export function LinkStatusBadge({ status, label, revokedBy }: { status: LinkStatus; label?: string; revokedBy?: string | null }) {
  const { cls, Icon } = BADGE[status];
  const text = linkStatusLabel(status, revokedBy);
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-input border px-2 py-0.5 text-xs font-semibold", cls)}>
      <Icon aria-hidden className="h-3.5 w-3.5" />
      {label ?? text}
    </span>
  );
}
