import Link from "next/link";
import { formatQty } from "@/lib/qty";
import type { LineStatus } from "@/server/db/schema";
import type { RequestView } from "@/server/services/requests";
import { Card, cn } from "./ui";

const STATUS_LABEL: Record<LineStatus, string> = {
  SENT: "Sent",
  ACCEPTED: "Accepted",
  REJECTED: "Rejected",
  PAYMENT_PENDING: "Payment pending",
  PAID: "Paid",
};
const STATUS_STYLE: Record<LineStatus, string> = {
  SENT: "border-info text-info",
  ACCEPTED: "border-primary text-primary",
  REJECTED: "border-danger text-danger",
  PAYMENT_PENDING: "border-warning text-warning",
  PAID: "border-success text-success",
};

export function StatusBadge({ status }: { status: LineStatus }) {
  return (
    <span className={cn("inline-block rounded-input border px-2 py-0.5 text-xs font-semibold", STATUS_STYLE[status])}>
      {STATUS_LABEL[status]}
    </span>
  );
}

export function formatDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

export function RequestCard({ request, link = true }: { request: RequestView; link?: boolean }) {
  return (
    <Card className="space-y-3 p-4" data-testid="request-card">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-semibold tabular-nums">{formatQty(request.totalBags)}</p>
          <p className="text-sm text-muted">Needed by {formatDate(request.neededBy)}</p>
          <p className="text-sm text-muted">
            {request.address}, {request.city} {request.pincode}
          </p>
        </div>
        {link && (
          <Link href={`/customer/requests/${request.id}`} className="min-h-11 py-2 text-sm font-semibold text-primary underline">
            Details
          </Link>
        )}
      </div>
      <ul className="space-y-2">
        {request.lines.map((l) => (
          <li key={l.id} className="flex items-center justify-between gap-2 border-t border-border pt-2">
            <span className="text-sm">{l.distributorName}</span>
            <span className="flex items-center gap-2">
              <span className="text-sm tabular-nums">{l.qtyBags} bags</span>
              <StatusBadge status={l.status} />
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
