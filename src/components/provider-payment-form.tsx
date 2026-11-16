"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatPaise, parseRupeesToPaise } from "@/lib/money";
import { PAYMENT_MODES } from "@/lib/constants";
import { Button, Field } from "./ui";

interface Props {
  invoiceId: string;
  invoiceNo: string;
  invoiceDate: string;
  outstandingPaise: number;
  today: string;
}

const tryParse = (s: string): number | null => {
  try {
    const p = parseRupeesToPaise(s.trim());
    return p >= 1 ? p : null;
  } catch {
    return null;
  }
};

/** Record a manual payment against one provider invoice. The server repeats every check; this only guides. */
export function ProviderPaymentForm({ invoiceId, invoiceNo, invoiceDate, outstandingPaise, today }: Props) {
  const router = useRouter();
  const [amount, setAmount] = useState("");
  const [paidOn, setPaidOn] = useState(today);
  const [mode, setMode] = useState<(typeof PAYMENT_MODES)[number]>("UPI");
  const [reference, setReference] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const paise = tryParse(amount);
  const over = paise !== null && paise > outstandingPaise ? `Max ${formatPaise(outstandingPaise)}` : undefined;
  const canSubmit = !busy && paise !== null && !over && paidOn >= invoiceDate && paidOn <= today;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const res = await fetch(`/api/provider-invoices/${encodeURIComponent(invoiceId)}/payments`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount: amount.trim(), paidOn, mode, ...(reference.trim() ? { reference: reference.trim() } : {}) }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string; fields?: Record<string, string> } | null;
      if (!res.ok) {
        const f = body?.fields ?? {};
        setFields(f);
        setError(["amount", "paidOn", "mode", "reference"].some((k) => f[k]) ? null : (body?.error ?? "Could not save the payment, please retry"));
        if (res.status === 409 || res.status === 422) router.refresh();
        return;
      }
      setAmount("");
      setReference("");
      router.refresh();
    } catch {
      setError("Network error, please retry");
    } finally {
      setBusy(false);
    }
  }

  const id = (k: string) => `pay-${invoiceId}-${k}`;
  return (
    <form onSubmit={submit} aria-label={`Record payment for ${invoiceNo}`} className="space-y-3 border-t border-border pt-3">
      <Field id={id("amount")} label="Amount (Rs)" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} error={fields.amount ?? over} />
      <Field id={id("date")} label="Paid on" type="date" min={invoiceDate} max={today} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} error={fields.paidOn} />
      <div className="space-y-1">
        <label htmlFor={id("mode")} className="text-sm font-semibold">Mode</label>
        <select id={id("mode")} value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className="min-h-11 w-full rounded-input border border-border bg-surface px-3 text-base">
          {PAYMENT_MODES.map((m) => <option key={m} value={m}>{m}</option>)}
        </select>
      </div>
      <Field id={id("ref")} label="Reference (optional)" maxLength={64} value={reference} onChange={(e) => setReference(e.target.value)} error={fields.reference} />
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" disabled={!canSubmit}>Record payment</Button>
    </form>
  );
}
