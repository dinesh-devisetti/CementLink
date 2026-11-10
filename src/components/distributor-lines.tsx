"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatPaise, parseRupeesToPaise } from "@/lib/money";
import type { DistributorLineView } from "@/server/services/lines";
import { StatusBadge, formatDate } from "./request-card";
import { Button, Card } from "./ui";

const withoutKey = (o: Record<string, string>, k: string) => Object.fromEntries(Object.entries(o).filter(([key]) => key !== k));

export function DistributorLines({ rows }: { rows: DistributorLineView[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [price, setPrice] = useState("");

  async function send(id: string, action: "accept" | "reject", payload?: object) {
    setBusyId(id);
    setErrors((e) => withoutKey(e, id));
    try {
      const res = await fetch(`/api/lines/${encodeURIComponent(id)}/${action}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload ?? {}),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string; fields?: Record<string, string> } | null;
        const msg = body?.fields?.pricePerBag ?? body?.error ?? "Could not update, please retry";
        setErrors((e) => ({ ...e, [id]: msg }));
        if (res.status === 409 || res.status === 403) router.refresh();
        return;
      }
      setAcceptingId(null);
      setRejectingId(null);
      setPrice("");
      router.refresh();
    } catch {
      setErrors((e) => ({ ...e, [id]: "Network error, please retry" }));
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) return <p className="rounded-card border border-border bg-surface p-4">No requests yet. Customers will see you once approved.</p>;

  let paise: number | null = null;
  try {
    paise = parseRupeesToPaise(price);
  } catch {
    paise = null;
  }

  return (
    <div className="space-y-3">
      {rows.map((l) => (
        <Card key={l.id} className="space-y-2 p-4" data-testid="line-card">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold">{l.customerName}</p>
              <p className="text-sm text-muted">
                {l.city} {l.pincode} · needed by {formatDate(l.neededBy)}
              </p>
              <p className="text-sm tabular-nums">{l.qtyBags} bags</p>
            </div>
            <StatusBadge status={l.status} />
          </div>
          {l.pricePerBagPaise !== null && l.amountPaise !== null && (
            <p className="text-sm tabular-nums">
              {formatPaise(l.pricePerBagPaise)}/bag · Total {formatPaise(l.amountPaise)}
            </p>
          )}
          {errors[l.id] && (
            <p role="alert" className="text-sm text-danger">
              {errors[l.id]}
            </p>
          )}
          {l.status === "SENT" && acceptingId !== l.id && rejectingId === l.id && (
            <div className="space-y-2 border-t border-border pt-2">
              <p className="text-sm font-semibold">Reject {l.customerName}&apos;s request? This cannot be undone.</p>
              <div className="flex gap-2">
                <Button type="button" disabled={busyId === l.id} aria-label={`Confirm reject ${l.customerName}`} onClick={() => send(l.id, "reject")}>
                  Yes, reject
                </Button>
                <Button type="button" disabled={busyId === l.id} onClick={() => setRejectingId(null)}>
                  Keep
                </Button>
              </div>
            </div>
          )}
          {l.status === "SENT" && acceptingId !== l.id && rejectingId !== l.id && (
            <div className="flex gap-2">
              <Button type="button" aria-label={`Accept ${l.customerName}`} onClick={() => { setAcceptingId(l.id); setPrice(""); setErrors((e) => withoutKey(e, l.id)); }}>
                Accept
              </Button>
              <Button type="button" disabled={busyId === l.id} aria-label={`Reject ${l.customerName}`} onClick={() => setRejectingId(l.id)}>
                Reject
              </Button>
            </div>
          )}
          {l.status === "SENT" && acceptingId === l.id && (
            <div className="space-y-2 border-t border-border pt-2">
              <label className="block text-sm font-semibold" htmlFor={`price-${l.id}`}>
                Price per bag (₹)
              </label>
              <input
                id={`price-${l.id}`}
                inputMode="decimal"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                className="min-h-11 w-full rounded-input border border-border px-3"
              />
              <p className="text-sm tabular-nums" aria-live="polite">
                {paise !== null && paise > 0 ? `${l.qtyBags} x ${formatPaise(paise)} = ${formatPaise(paise * l.qtyBags)}` : "Enter a price like 385.50"}
              </p>
              <div className="flex gap-2">
                <Button type="button" disabled={busyId === l.id || paise === null || paise <= 0} onClick={() => send(l.id, "accept", { pricePerBag: price })}>
                  Confirm
                </Button>
                <Button type="button" disabled={busyId === l.id} onClick={() => setAcceptingId(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
        </Card>
      ))}
    </div>
  );
}
