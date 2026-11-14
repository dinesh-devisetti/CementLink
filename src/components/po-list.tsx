import Link from "next/link";
import { formatPaise } from "@/lib/money";
import { formatTonnes } from "@/lib/qty";
import type { PoView } from "@/server/services/pos";
import { PoStatusBadge } from "./po-status-badge";

/** Placed/all POs as cards. The provider variant links to its read-only detail page. */
export function PoList({ pos, total, role, from }: { pos: PoView[]; total: number; role: "DISTRIBUTOR" | "PROVIDER"; from?: "placed" | "all" }) {
  if (pos.length === 0) {
    return <p className="rounded-card border border-border bg-surface p-4">{role === "PROVIDER" ? "No purchase orders yet." : "No purchase orders here yet."}</p>;
  }
  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {pos.map((p) => {
          const city = p.items[0]?.city;
          const body = (
            <>
              <div className="flex items-start justify-between gap-3">
                <p className="font-semibold">
                  <span className="tabular-nums">{formatTonnes(p.qtyKg)}</span>
                  <span className="font-normal text-muted"> - {role === "PROVIDER" ? p.distributorName : (p.providerName ?? "No provider yet")}</span>
                </p>
                <PoStatusBadge status={p.status} />
              </div>
              <p className="text-sm text-muted">
                {p.items.length} {p.items.length === 1 ? "order" : "orders"}
                {city ? `, delivery ${city}` : ""}
                {p.totalPaise !== null ? `, ${formatPaise(p.totalPaise)}` : ""}
              </p>
            </>
          );
          return (
            <li key={p.id} className="rounded-card border border-border bg-surface p-4">
              {role === "PROVIDER" || p.status !== "DRAFT" ? <Link href={`/${role === "PROVIDER" ? "provider/orders" : "distributor/pos"}/${p.id}${role === "DISTRIBUTOR" && from ? `?from=${from}` : ""}`} className="block space-y-1">{body}</Link> : <div className="space-y-1">{body}</div>}
            </li>
          );
        })}
      </ul>
      {pos.length < total && <p className="text-sm text-muted">Showing the latest {pos.length} of {total} purchase orders.</p>}
    </div>
  );
}
