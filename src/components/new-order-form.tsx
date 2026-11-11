"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { formatTonnes } from "@/lib/qty";
import { summarizeSplit, type SplitRowInput } from "@/lib/split";
import { AlertBox, Button, Field } from "./ui";

interface Option {
  id: string;
  name: string;
}

const selectCls = "min-h-11 w-full rounded-input border border-border bg-surface px-3 text-base";
const ghost = "border border-border bg-transparent text-text";

/** Customer order: pick a linked distributor, optionally split by provider; the remainder is the distributor's choice. */
export function NewOrderForm({ distributors, today }: { distributors: Option[]; today: string }) {
  const router = useRouter();
  const [distributorId, setDistributorId] = useState(distributors.length === 1 ? distributors[0].id : "");
  const [providers, setProviders] = useState<Option[]>([]);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [total, setTotal] = useState("");
  const [rows, setRows] = useState<SplitRowInput[]>([]);
  const [neededBy, setNeededBy] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [pincode, setPincode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});

  useEffect(() => {
    setProviders([]);
    setRows([]);
    setProviderError(null);
    if (!distributorId) return;
    const ctl = new AbortController();
    fetch(`/api/distributors/${encodeURIComponent(distributorId)}/providers`, { signal: ctl.signal })
      .then(async (res) => {
        const j = (await res.json().catch(() => null)) as { data?: Array<{ id: string; businessName: string }>; error?: string } | null;
        if (!res.ok) throw new Error(j?.error ?? "Could not load providers");
        setProviders((j?.data ?? []).map((p) => ({ id: p.id, name: p.businessName })));
      })
      .catch((e: unknown) => {
        if (!ctl.signal.aborted) setProviderError(e instanceof Error ? e.message : "Could not load providers");
      });
    return () => ctl.abort();
  }, [distributorId]);

  const split = summarizeSplit(total, rows);
  const used = new Set(rows.map((r) => r.providerId));
  const nextProvider = providers.find((p) => !used.has(p.id));
  const updateRow = (i: number, patch: Partial<SplitRowInput>) => setRows(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          distributorId, qtyTonnes: total.trim(), neededBy, address, city, pincode,
          allocations: rows.map((r) => ({ providerId: r.providerId, qtyTonnes: r.tonnes.trim() })),
        }),
      });
      const j = (await res.json().catch(() => null)) as { data?: { id: string }; error?: string; fields?: Record<string, string> } | null;
      if (res.ok && j?.data) {
        // Stay busy while navigating so a double click cannot place a second order.
        router.push(`/customer/orders/${j.data.id}`);
        return;
      }
      setFields(j?.fields ?? {});
      setError(j?.error ?? "Could not place the order, please retry");
      setBusy(false);
    } catch {
      setError("Network error, please retry");
      setBusy(false);
    }
  }

  if (distributors.length === 0) {
    return (
      <p className="rounded-card border border-border bg-surface p-4">
        You need an active distributor link first. Open the Distributors tab to request one.
      </p>
    );
  }

  const ready = distributorId && split.ok && neededBy && address.trim() && city.trim() && pincode;
  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="space-y-1">
        <label htmlFor="o-dist" className="text-sm font-semibold">Distributor</label>
        <select id="o-dist" value={distributorId} onChange={(e) => setDistributorId(e.target.value)} className={selectCls}>
          <option value="">Choose...</option>
          {distributors.map((d) => (
            <option key={d.id} value={d.id}>{d.name}</option>
          ))}
        </select>
        {fields.distributorId && <p className="text-sm text-danger">{fields.distributorId}</p>}
      </div>

      <Field id="o-total" label="Total quantity (tonnes)" inputMode="decimal" autoComplete="off" value={total} onChange={(e) => setTotal(e.target.value)}
        error={fields.qtyTonnes ?? (total && split.totalKg === null ? "Enter tonnes with up to 3 decimals (max 1000)" : undefined)} />

      <fieldset className="space-y-2 rounded-card border border-border bg-surface p-4">
        <legend className="px-1 text-sm font-semibold">Split by provider (optional)</legend>
        {providerError && <p role="alert" className="text-sm text-danger">{providerError}</p>}
        {distributorId && !providerError && providers.length === 0 && <p className="text-sm text-muted">This distributor has no linked providers yet.</p>}
        {rows.map((r, i) => (
          <div key={i} className="grid grid-cols-[1fr_7rem_auto] items-start gap-2">
            <div>
              <label htmlFor={`o-prov-${i}`} className="sr-only">Provider {i + 1}</label>
              <select id={`o-prov-${i}`} value={r.providerId} onChange={(e) => updateRow(i, { providerId: e.target.value })} className={selectCls}>
                <option value="">Provider...</option>
                {providers.filter((p) => p.id === r.providerId || !used.has(p.id)).map((p) => (
                  <option key={p.id} value={p.id}>{p.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor={`o-qty-${i}`} className="sr-only">Tonnes for provider {i + 1}</label>
              <input id={`o-qty-${i}`} inputMode="decimal" autoComplete="off" placeholder="Tonnes" value={r.tonnes} onChange={(e) => updateRow(i, { tonnes: e.target.value })}
                aria-invalid={split.rowErrors[i] ? true : undefined} className="min-h-11 w-full rounded-input border border-border bg-surface px-3 text-base" />
            </div>
            <Button type="button" className={ghost} aria-label={`Remove provider ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
              Remove
            </Button>
            {split.rowErrors[i] && <p role="alert" className="col-span-3 text-sm text-danger">{split.rowErrors[i]}</p>}
          </div>
        ))}
        <Button type="button" className={ghost} disabled={!nextProvider} onClick={() => nextProvider && setRows([...rows, { providerId: nextProvider.id, tonnes: "" }])}>
          Add provider
        </Button>
        <p aria-live="polite" className={split.over ? "text-sm font-semibold text-danger" : "text-sm text-muted"} data-testid="unallocated">
          {split.over
            ? "Provider quantities are more than the order total"
            : split.remainderKg === null
              ? "Enter the total to see the unallocated quantity"
              : `Unallocated: ${formatTonnes(split.remainderKg)} -> distributor's choice`}
        </p>
        {fields.allocations && <p role="alert" className="text-sm text-danger">{fields.allocations}</p>}
      </fieldset>

      <Field id="o-needed" label="Needed by" type="date" min={today} value={neededBy} onChange={(e) => setNeededBy(e.target.value)} error={fields.neededBy} />
      <Field id="o-address" label="Delivery address" autoComplete="street-address" maxLength={300} value={address} onChange={(e) => setAddress(e.target.value)} error={fields.address} />
      <Field id="o-city" label="City" autoComplete="address-level2" maxLength={80} value={city} onChange={(e) => setCity(e.target.value)} error={fields.city} />
      <Field id="o-pin" label="Pincode" inputMode="numeric" autoComplete="postal-code" maxLength={6} value={pincode} onChange={(e) => setPincode(e.target.value)} error={fields.pincode} />

      {error && <AlertBox>{error}</AlertBox>}
      <Button type="submit" className="w-full" disabled={busy || !ready}>Place order</Button>
    </form>
  );
}
