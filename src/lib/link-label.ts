import type { LinkStatus } from "@/server/db/schema";

const LABELS: Record<LinkStatus, string> = { PENDING: "Pending", ACTIVE: "Active", REJECTED: "Rejected", REVOKED: "Revoked" };

/** Badge text. A REVOKED link with revoked_by NULL was never active: the requester cancelled it. */
export function linkStatusLabel(status: LinkStatus, revokedBy?: string | null): string {
  return status === "REVOKED" && revokedBy === null ? "Cancelled" : LABELS[status];
}
