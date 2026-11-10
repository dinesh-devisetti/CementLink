"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatPaise } from "@/lib/money";
import type { PoView } from "@/server/services/pos";
import { PoBadge } from "./po-badge";
import { Button, Card } from "./ui";

export function ProviderOrders({ rows }: { rows: PoView[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  async function send(id: string, action: "confirm" | "reject") {
    setBusyId(id);
    setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== id)));
    try {
      const res = await fetch(`/api/pos/${encodeURIComponent(id)}/${action}`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setErrors((e) => ({ ...e, [id]: body?.error ?? "Could not update, please retry" }));
        if (res.status === 409 || res.status === 403) router.refresh();
        return;
      }
      setRejectingId(null);
      router.refresh();
    } catch {
      setErrors((e) => ({ ...e, [id]: "Network error, please retry" }));
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) return <p className="rounded-card border border-border bg-surface p-4">No orders yet</p>;

  return (
    <ul className="space-y-3">
      {rows.map((p) => (
        <Card key={p.id} className="space-y-2 p-4" data-testid="po-card">
          <div className="flex items-start justify-between gap-2">
            <p className="font-semibold">{p.counterparty}</p>
            <PoBadge status={p.status} />
          </div>
          <p className="text-sm tabular-nums">
            {p.qtyBags} bags · {formatPaise(p.ratePerBagPaise)}/bag · Total {formatPaise(p.totalPaise)}
          </p>
          {errors[p.id] && (
            <p role="alert" className="text-sm text-danger">
              {errors[p.id]}
            </p>
          )}
          {p.status === "PLACED" && rejectingId !== p.id && (
            <div className="flex gap-2">
              <Button type="button" disabled={busyId === p.id} aria-label={`Confirm order from ${p.counterparty}`} onClick={() => send(p.id, "confirm")}>
                Confirm
              </Button>
              <Button type="button" disabled={busyId === p.id} aria-label={`Reject order from ${p.counterparty}`} onClick={() => setRejectingId(p.id)}>
                Reject
              </Button>
            </div>
          )}
          {p.status === "PLACED" && rejectingId === p.id && (
            <div className="space-y-2 border-t border-border pt-2">
              <p className="text-sm font-semibold">Reject this order? This cannot be undone.</p>
              <div className="flex gap-2">
                <Button type="button" disabled={busyId === p.id} aria-label={`Confirm reject order from ${p.counterparty}`} onClick={() => send(p.id, "reject")}>
                  Yes, reject
                </Button>
                <Button type="button" disabled={busyId === p.id} onClick={() => setRejectingId(null)}>
                  Keep
                </Button>
              </div>
            </div>
          )}
        </Card>
      ))}
    </ul>
  );
}
