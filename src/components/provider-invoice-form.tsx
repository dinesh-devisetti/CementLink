"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatPaise, parseRupeesToPaise } from "@/lib/money";
import { formatTonnes, kgToTonnes, tonnesToKg } from "@/lib/qty";
import { invoiceAmountPaise } from "@/lib/validation/provider-invoices";
import { Button, Field } from "./ui";

interface Props {
  poId: string;
  qtyKg: number;
  remainingKg: number;
  defaultRatePaise: number | null;
  placedOn: string;
  today: string;
}

const tryParse = <T,>(f: () => T): T | null => {
  try {
    return f();
  } catch {
    return null;
  }
};

/** Invoice form for a DISPATCHED PO. All checks are repeated by the server; this only guides. */
export function ProviderInvoiceForm({ poId, qtyKg, remainingKg, defaultRatePaise, placedOn, today }: Props) {
  const router = useRouter();
  const [no, setNo] = useState("");
  const [date, setDate] = useState(today);
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState(defaultRatePaise === null ? "" : (defaultRatePaise / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const kg = tryParse(() => tonnesToKg(qty.trim()));
  const ratePaise = tryParse(() => {
    const p = parseRupeesToPaise(rate.trim());
    return p >= 1 ? p : null;
  });
  const amount = kg !== null && ratePaise !== null ? invoiceAmountPaise(kg, ratePaise) : null;
  const overQty = kg !== null && kg > remainingKg ? `Max ${kgToTonnes(remainingKg)} t` : undefined;
  const canSubmit = !busy && no.trim() !== "" && date !== "" && kg !== null && amount !== null && amount > 0 && !overQty;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const res = await fetch(`/api/pos/${encodeURIComponent(poId)}/invoices`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invoiceNo: no.trim(), invoiceDate: date, qtyTonnes: qty.trim(), ratePerTonne: rate.trim() }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string; fields?: Record<string, string> } | null;
      if (!res.ok) {
        const f = body?.fields ?? {};
        setFields(f);
        const shown = ["invoiceNo", "invoiceDate", "qtyTonnes", "ratePerTonne"].some((k) => f[k]);
        setError(shown ? null : (body?.error ?? "Could not save the invoice, please retry"));
        if (res.status === 409 || res.status === 422) router.refresh();
        return;
      }
      setNo("");
      setQty("");
      router.refresh();
    } catch {
      setError("Network error, please retry");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} aria-label="New invoice" className="space-y-3 rounded-card border border-border bg-surface p-4">
      <h2 className="text-xl font-semibold">New invoice</h2>
      <Field id="inv-no" label="Invoice no." value={no} maxLength={40} onChange={(e) => setNo(e.target.value)} error={fields.invoiceNo} />
      <Field id="inv-date" label="Invoice date" type="date" min={placedOn} max={today} value={date} onChange={(e) => setDate(e.target.value)} error={fields.invoiceDate} />
      <Field id="inv-qty" label="Quantity (tonnes)" inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} error={fields.qtyTonnes ?? overQty} />
      <p className="text-sm text-muted">Remaining {formatTonnes(remainingKg)} of {formatTonnes(qtyKg)}</p>
      <Field id="inv-rate" label="Rate per tonne (Rs)" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} error={fields.ratePerTonne} />
      <p className="text-sm tabular-nums" aria-live="polite" aria-atomic="true">
        Amount: {amount !== null && kg !== null && ratePaise !== null ? `${kgToTonnes(kg)} t x ${formatPaise(ratePaise)} = ${formatPaise(amount)}` : "enter tonnes and a rate"}
      </p>
      <p className="text-sm text-muted">Internal record, not a GST invoice.</p>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      <Button type="submit" disabled={!canSubmit}>Save invoice</Button>
    </form>
  );
}

