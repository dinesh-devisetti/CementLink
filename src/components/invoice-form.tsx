"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { MAX_PRICE_PAISE } from "@/lib/constants";
import { formatPaise, parseRupeesToPaise } from "@/lib/money";
import { todayIst } from "@/lib/qty-input";
import { Button, Card, Field } from "./ui";

interface Props {
  poId: string;
  remainingBags: number;
  defaultRatePaise: number;
}

function parseRate(s: string): number | null {
  try {
    const p = parseRupeesToPaise(s.trim());
    return p > 0 && p <= MAX_PRICE_PAISE ? p : null;
  } catch {
    return null;
  }
}

export function InvoiceForm({ poId, remainingBags, defaultRatePaise }: Props) {
  const router = useRouter();
  const [no, setNo] = useState("");
  const [date, setDate] = useState(() => todayIst());
  const [qty, setQty] = useState("");
  const [rate, setRate] = useState((defaultRatePaise / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  const q = /^\d{1,6}$/.test(qty) && Number(qty) > 0 ? Number(qty) : null;
  const r = parseRate(rate);
  const clientQtyError = q !== null && q > remainingBags ? `Max ${remainingBags} bags` : undefined;
  const canSubmit = !busy && no.trim() !== "" && date !== "" && q !== null && r !== null && !clientQtyError;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit || q === null) return;
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const res = await fetch(`/api/pos/${encodeURIComponent(poId)}/invoices`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ invoiceNo: no.trim(), invoiceDate: date, qtyBags: q, ratePerBag: rate.trim() }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string; fields?: Record<string, string> } | null;
      if (!res.ok) {
        const f = body?.fields ?? {};
        setFields(f);
        const shown = ["invoiceNo", "invoiceDate", "qtyBags", "ratePerBag"].some((k) => f[k]);
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
    <Card className="space-y-3 p-4">
      <form onSubmit={submit} className="space-y-3" aria-label="New invoice">
        <Field id="inv-no" label="Invoice no." value={no} maxLength={40} onChange={(e) => setNo(e.target.value)} error={fields.invoiceNo} />
        <Field id="inv-date" label="Invoice date" type="date" max={todayIst()} value={date} onChange={(e) => setDate(e.target.value)} error={fields.invoiceDate} />
        <Field
          id="inv-qty"
          label="Qty supplied (bags)"
          inputMode="numeric"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          error={fields.qtyBags ?? clientQtyError}
        />
        <p className="text-sm text-muted">Max {remainingBags} bags</p>
        <Field id="inv-rate" label="Rate per bag (₹)" inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} error={fields.ratePerBag} />
        <p className="text-sm tabular-nums" aria-live="polite">
          Amount: {q !== null && r !== null ? `${q} x ${formatPaise(r)} = ${formatPaise(q * r)}` : "enter bags and a rate"}
        </p>
        <p className="text-sm text-muted">Internal record, not a GST invoice.</p>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button type="submit" disabled={!canSubmit}>
          Save invoice
        </Button>
      </form>
    </Card>
  );
}
