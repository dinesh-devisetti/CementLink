"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatPaise, parseRupeesToPaise } from "@/lib/money";
import type { PoView, ProviderOption } from "@/server/services/pos";
import { PoBadge } from "./po-badge";
import { Button, Card, Field } from "./ui";

interface Props {
  providers: ProviderOption[];
  rows: PoView[];
  unfulfilledBags: number;
}

function parseQty(s: string): number | null {
  return /^\d{1,6}$/.test(s) && Number(s) > 0 ? Number(s) : null;
}
function parseRate(s: string): number | null {
  try {
    const p = parseRupeesToPaise(s.trim());
    return p > 0 ? p : null;
  } catch {
    return null;
  }
}

export function PoManager({ providers, rows, unfulfilledBags }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [providerId, setProviderId] = useState("");
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const q = parseQty(qty);
  const r = parseRate(rate);
  const open_ = Math.max(0, unfulfilledBags);
  const over = q !== null && q > open_ ? q - open_ : 0;
  const canSubmit = !busy && providerId !== "" && q !== null && r !== null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || q === null) return;
    setBusy(true);
    setError(null);
    setFieldErrors({});
    try {
      const res = await fetch("/api/pos", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId, qtyBags: q, ratePerBag: rate.trim() }),
      });
      const body = (await res.json().catch(() => null)) as {
        error?: string;
        fields?: Record<string, string>;
        data?: { overOrderBags: number };
      } | null;
      if (!res.ok) {
        setFieldErrors(body?.fields ?? {});
        setError(body?.fields ? null : (body?.error ?? "Could not place the order, please retry"));
        return;
      }
      setNotice(body?.data?.overOrderBags ? `Order placed (${body.data.overOrderBags} bags above current demand).` : "Order placed.");
      setOpen(false);
      setQty("");
      setRate("");
      setProviderId("");
      router.refresh();
    } catch {
      setError("Network error, please retry");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {notice && (
        <p role="status" className="text-sm text-success">
          {notice}
        </p>
      )}
      {!open && (
        <Button type="button" onClick={() => { setOpen(true); setNotice(null); }}>
          + New PO
        </Button>
      )}
      {open && (
        <Card className="space-y-3 p-4">
          <form onSubmit={submit} className="space-y-3" aria-label="New purchase order">
            <div className="space-y-1">
              <label htmlFor="po-provider" className="text-sm font-semibold">
                Provider
              </label>
              <select
                id="po-provider"
                value={providerId}
                onChange={(e) => setProviderId(e.target.value)}
                className="min-h-11 w-full rounded-input border border-border bg-surface px-3 text-base"
              >
                <option value="">Select a provider</option>
                {providers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.businessName}
                    {p.city ? ` (${p.city})` : ""}
                  </option>
                ))}
              </select>
              {fieldErrors.providerId && <p className="text-sm text-danger">{fieldErrors.providerId}</p>}
            </div>
            <Field id="po-qty" label="Quantity (bags)" inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} error={fieldErrors.qtyBags} />
            <Field id="po-rate" label="Rate per bag (₹)" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} error={fieldErrors.ratePerBag} />
            <p className="text-sm tabular-nums" aria-live="polite">
              {q !== null && r !== null ? `${q} x ${formatPaise(r)} = ${formatPaise(q * r)}` : "Enter bags and a rate like 385.50"}
            </p>
            {over > 0 && (
              <p role="status" className="rounded-input border border-warning p-3 text-sm text-warning">
                {over} bags more than unfulfilled demand ({open_} bags). You can still place it.
              </p>
            )}
            {providers.length === 0 && <p className="text-sm text-muted">No approved providers yet.</p>}
            {error && (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            )}
            <div className="flex gap-2">
              <Button type="submit" disabled={!canSubmit}>
                Place order
              </Button>
              <Button type="button" disabled={busy} onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}
      {rows.length === 0 ? (
        <p className="rounded-card border border-border bg-surface p-4">No purchase orders</p>
      ) : (
        <ul className="space-y-3">
          {rows.map((p) => (
            <Card key={p.id} className="space-y-1 p-4" data-testid="po-card">
              <div className="flex items-start justify-between gap-2">
                <p className="font-semibold">{p.counterparty}</p>
                <PoBadge status={p.status} />
              </div>
              <p className="text-sm tabular-nums">
                {p.qtyBags} bags · {formatPaise(p.ratePerBagPaise)}/bag · Total {formatPaise(p.totalPaise)}
              </p>
            </Card>
          ))}
        </ul>
      )}
    </div>
  );
}
