"use client";

import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { bagsToTonnes } from "@/lib/qty";
import { mapServerFields, remainingBags, splitEvenly, submitBlocker, type Allocations } from "@/lib/split";
import { resolveTotalBags, todayIst, type QtyUnit } from "@/lib/qty-input";
import { AlertBox, Button, Field } from "./ui";

export interface DistributorChoice {
  id: string;
  businessName: string | null;
  city: string | null;
}

export function NewRequestForm({ distributors }: { distributors: DistributorChoice[] }) {
  const router = useRouter();
  const [unit, setUnit] = useState<QtyUnit>("BAGS");
  const [quantity, setQuantity] = useState("");
  const [alloc, setAlloc] = useState<Allocations>({});
  const [fields, setFields] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const today = useMemo(() => todayIst(), []);

  const { total, qtyError } = useMemo(() => {
    if (quantity.trim() === "") return { total: null, qtyError: undefined };
    try {
      return { total: resolveTotalBags(unit, quantity.trim()), qtyError: undefined };
    } catch (e) {
      return { total: null, qtyError: (e as Error).message };
    }
  }, [unit, quantity]);

  const remaining = remainingBags(total, alloc);
  const blocker = submitBlocker(total, alloc);

  function toggle(id: string, on: boolean) {
    setAlloc((prev) => {
      if (!on) return Object.fromEntries(Object.entries(prev).filter(([k]) => k !== id));
      return { ...prev, [id]: "" };
    });
  }

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (blocker) return;
    setBusy(true);
    setError(null);
    setFields({});
    const f = new FormData(e.currentTarget);
    const get = (k: string) => String(f.get(k) ?? "");
    const payload = {
      unit,
      quantity: quantity.trim(),
      address: get("address"),
      city: get("city"),
      pincode: get("pincode"),
      neededBy: get("neededBy"),
      allocations: Object.entries(alloc).map(([distributorId, bags]) => ({ distributorId, bags: Number(bags) })),
    };
    try {
      const res = await fetch("/api/requests", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        if (body?.code === "VALIDATION" && body.fields) {
          const mapped = mapServerFields(body.fields);
          setFields(mapped.fields);
          if (mapped.general) setError(mapped.general);
        }
        else setError(body?.error ?? "Could not send the request, please retry");
        return;
      }
      router.replace("/customer");
      router.refresh();
    } catch {
      setError("Network error, please retry");
    } finally {
      setBusy(false);
    }
  }

  if (distributors.length === 0) {
    return <p className="rounded-card border border-border bg-surface p-4">No distributors available yet</p>;
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4 pb-24" noValidate>
      {error && <AlertBox>{error}</AlertBox>}
      <div className="space-y-2">
        <Field
          id="quantity"
          label="Quantity"
          inputMode="decimal"
          value={quantity}
          onChange={(e) => {
            setQuantity(e.target.value);
            setFields((f) => Object.fromEntries(Object.entries(f).filter(([k]) => k !== "quantity")));
          }}
          error={qtyError ?? fields.quantity}
        />
        <div role="radiogroup" aria-label="Unit" className="flex gap-4">
          {(["BAGS", "TONNES"] as const).map((u) => (
            <label key={u} className="flex min-h-11 items-center gap-2">
              <input type="radio" name="unit" checked={unit === u} onChange={() => setUnit(u)} />
              {u === "BAGS" ? "Bags" : "Tonnes"}
            </label>
          ))}
        </div>
        {total !== null && (
          <p className="text-sm text-muted" data-testid="qty-summary">
            = {bagsToTonnes(total)} t / {total} bags
          </p>
        )}
      </div>
      <Field id="address" label="Address" autoComplete="street-address" error={fields.address} />
      <div className="grid grid-cols-2 gap-3">
        <Field id="city" label="City" autoComplete="address-level2" error={fields.city} />
        <Field id="pincode" label="Pincode" inputMode="numeric" maxLength={6} autoComplete="postal-code" error={fields.pincode} />
      </div>
      <Field id="neededBy" label="Needed by" type="date" min={today} error={fields.neededBy} />

      <fieldset className="space-y-2">
        <legend className="text-sm font-semibold">Split across distributors</legend>
        {distributors.map((d) => {
          const on = d.id in alloc;
          const name = d.businessName ?? "Distributor";
          return (
            <div key={d.id} className="flex min-h-11 items-center gap-3">
              <label className="flex flex-1 items-center gap-2">
                <input type="checkbox" checked={on} onChange={(e) => toggle(d.id, e.target.checked)} />
                <span>
                  {name}
                  {d.city ? <span className="text-sm text-muted"> ({d.city})</span> : null}
                </span>
              </label>
              {on && (
                <input
                  aria-label={`Bags for ${name}`}
                  inputMode="numeric"
                  value={alloc[d.id]}
                  onChange={(e) => setAlloc((p) => ({ ...p, [d.id]: e.target.value.replace(/\D/g, "").slice(0, 7) }))}
                  className="min-h-11 w-24 rounded-input border border-border bg-surface px-3 text-base tabular-nums"
                />
              )}
            </div>
          );
        })}
        {fields.allocations && <p className="text-sm text-danger">{fields.allocations}</p>}
        <button
          type="button"
          className="min-h-11 text-sm font-semibold text-primary underline disabled:opacity-60"
          disabled={total === null || Object.keys(alloc).length === 0}
          onClick={() => total !== null && setAlloc(splitEvenly(total, Object.keys(alloc)))}
        >
          Split evenly
        </button>
        <p
          data-testid="remaining"
          aria-live="polite"
          className={remaining === 0 ? "text-sm font-semibold text-success" : "text-sm font-semibold text-danger"}
        >
          {remaining === null ? "Enter a quantity to allocate" : remaining === 0 ? "All bags allocated" : `Remaining: ${remaining} bags`}
        </p>
      </fieldset>

      <div className="fixed inset-x-0 bottom-0 space-y-1 border-t border-border bg-surface p-3">
        {blocker && <p className="text-sm text-muted">{blocker}</p>}
        <Button type="submit" disabled={busy || blocker !== null} className="w-full">
          {busy ? "Sending..." : "Send request"}
        </Button>
      </div>
    </form>
  );
}
