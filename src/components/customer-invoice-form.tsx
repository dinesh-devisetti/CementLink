"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatPaise, parseRupeesToPaise } from "@/lib/money";
import { kgToTonnes } from "@/lib/qty";
import { invoiceAmountPaise } from "@/lib/validation/provider-invoices";
import { Button, Field } from "./ui";

/** Distributor invoices a DELIVERED order. Qty is the order qty (read-only); the server recomputes the amount. */
export function CustomerInvoiceForm({ orderId, qtyKg, deliveredOn, today }: { orderId: string; qtyKg: number; deliveredOn: string; today: string }) {
  const router = useRouter();
  const [no, setNo] = useState("");
  const [date, setDate] = useState(today);
  const [rate, setRate] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  let ratePaise: number | null = null;
  try {
    const p = parseRupeesToPaise(rate.trim());
    ratePaise = p >= 1 ? p : null;
  } catch {
    ratePaise = null;
  }
  const amount = ratePaise === null ? null : invoiceAmountPaise(qtyKg, ratePaise);
  const canSubmit = !busy && no.trim() !== "" && date !== "" && amount !== null && amount > 0;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const res = await fetch(`/api/orders/${encodeURIComponent(orderId)}/invoice`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invoiceNo: no.trim(), invoiceDate: date, ratePerTonne: rate.trim() }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string; fields?: Record<string, string> } | null;
      if (!res.ok) {
        const f = body?.fields ?? {};
        setFields(f);
        setError(["invoiceNo", "invoiceDate", "ratePerTonne"].some((k) => f[k]) ? null : (body?.error ?? "Could not save the invoice, please retry"));
        if (res.status === 409) router.refresh();
        return;
      }
      router.refresh();
    } catch {
      setError("Network error, please retry");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label="Customer invoice" className="space-y-3 rounded-card border border-border bg-surface p-4">
      <h2 className="text-xl font-semibold">Create customer invoice</h2>
      <Field id="ci-no" label="Invoice no." value={no} maxLength={40} onChange={(e) => setNo(e.target.value)} error={fields.invoiceNo} />
      <Field id="ci-date" label="Invoice date" type="date" min={deliveredOn} max={today} value={date} onChange={(e) => setDate(e.target.value)} error={fields.invoiceDate} />
      <p className="text-sm">Quantity: <span className="tabular-nums">{kgToTonnes(qtyKg)} t</span> (the order quantity)</p>
      <Field id="ci-rate" label="Rate per tonne (Rs)" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} error={fields.ratePerTonne} />
      <p className="text-sm tabular-nums" aria-live="polite" aria-atomic="true">
        Amount: {amount !== null && ratePaise !== null ? `${kgToTonnes(qtyKg)} t x ${formatPaise(ratePaise)} = ${formatPaise(amount)}` : "enter a rate"}
      </p>
      <p className="text-sm text-muted">Internal record, not a GST invoice.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" disabled={!canSubmit}>Save invoice</Button>
    </form>
  );
}
