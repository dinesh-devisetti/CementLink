"use client";

import Link from "next/link";
import { useState } from "react";
import { kgToTonnes } from "@/lib/qty";
import type { PoView } from "@/server/services/pos";
import { Button, Field } from "./ui";

export interface ProviderOption {
  id: string;
  name: string;
}

type Run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => Promise<void>;

const SELECT = "min-h-11 w-full rounded-input border border-border bg-surface px-3 text-base";

/** One draft PO: provider, optional rate, and per-item quantity edit and split. Every save carries the draft's version. */
export function DraftCard({
  draft, index, providers, selected, onToggle, run, send, busy,
}: {
  busy: boolean;
  draft: PoView;
  index: number;
  providers: ProviderOption[];
  selected: boolean;
  onToggle: () => void;
  run: Run;
  send: (url: string, method: "POST" | "PATCH", body?: unknown) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const label = `draft ${index + 1}`;
  const version = draft.version ?? 0;
  const [rate, setRate] = useState(draft.ratePerTonnePaise === null ? "" : (draft.ratePerTonnePaise / 100).toFixed(2));
  return (
    <li className="space-y-3 rounded-card border border-dashed border-border bg-surface p-4">
      <div className="flex items-start gap-3">
        <input type="checkbox" className="mt-3 h-5 w-5" aria-label={`Select ${label}`} checked={selected} onChange={onToggle} disabled={busy} />
        <div className="flex-1 space-y-2">
          <p className="font-semibold">Draft {index + 1}: <span className="tabular-nums">{kgToTonnes(draft.qtyKg)} t</span></p>
          <label className="block space-y-1 text-sm font-semibold">
            Provider
            <select
              aria-label={`Provider for ${label}`}
              className={SELECT}
              disabled={busy}
              value={draft.providerId ?? ""}
              onChange={(e) => void run(() => send(`/api/pos/${draft.id}`, "PATCH", { version, providerId: e.target.value || null }))}
            >
              <option value="">Choose provider</option>
              {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          {!draft.providerId && <p role="status" className="text-sm text-warning">Choose a provider before placing.</p>}
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <Field id={`rate-${draft.id}`} label={`Rate Rs per tonne (optional) for ${label}`} inputMode="decimal" value={rate} onChange={(e) => setRate(e.target.value)} />
            </div>
            <Button
              type="button"
              disabled={busy}
              className="border border-border bg-transparent text-text"
              onClick={() => void run(() => send(`/api/pos/${draft.id}`, "PATCH", { version, ratePerTonne: rate.trim() === "" ? null : rate.trim() }))}
            >
              Save rate
            </Button>
          </div>
        </div>
      </div>
      {draft.items.length > 1 && <SplitBack draft={draft} label={label} version={version} run={run} send={send} busy={busy} />}
      <ul className="space-y-3">
        {draft.items.map((it) => (
          <ItemRow key={`${it.id}-${it.qtyKg}-${version}`} item={it} draftLabel={label} version={version} providers={providers} run={run} send={send} busy={busy} />
        ))}
      </ul>
    </li>
  );
}

type Send = (url: string, method: "POST" | "PATCH", body?: unknown) => Promise<{ ok: true } | { ok: false; error: string }>;

/** Split-back for a combined draft: choose the order items to move into a new draft; at least one must stay. */
function SplitBack({ draft, label, version, run, send, busy }: { draft: PoView; label: string; version: number; run: Run; send: Send; busy: boolean }) {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<ReadonlySet<string>>(new Set());
  const ids = draft.items.map((i) => i.id).filter((x): x is string => x !== null);
  const reason = chosen.size === 0 ? "Choose the orders to move out." : chosen.size >= ids.length ? "At least one order must stay in the draft." : null;
  const toggle = (id: string) => setChosen((c) => (c.has(id) ? new Set([...c].filter((x) => x !== id)) : new Set([...c, id])));
  return (
    <div className="space-y-2">
      <Button type="button" disabled={busy} className="border border-border bg-transparent text-text" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        Split back {label}
      </Button>
      {open && (
        <div role="group" aria-label={`Split back ${label}`} className="space-y-2 rounded-input border border-border p-3">
          {draft.items.map((i) => (
            <label key={i.id} className="flex min-h-11 items-center gap-2 text-sm">
              <input type="checkbox" className="h-5 w-5" checked={chosen.has(i.id ?? "")} onChange={() => i.id && toggle(i.id)} />
              Move order #{i.orderId.slice(-4)} ({kgToTonnes(i.qtyKg)} t) to a new draft
            </label>
          ))}
          {reason && <p role="status" className="text-sm text-muted">{reason}</p>}
          <Button type="button" disabled={busy || reason !== null} onClick={() => void run(() => send(`/api/pos/${draft.id}/split-back`, "POST", { version, itemIds: [...chosen] }))}>
            Split back selected
          </Button>
        </div>
      )}
    </div>
  );
}

function ItemRow({
  item, draftLabel, version, providers, run, send, busy,
}: {
  busy: boolean;
  item: PoView["items"][number];
  draftLabel: string;
  version: number;
  providers: ProviderOption[];
  run: Run;
  send: (url: string, method: "POST" | "PATCH", body?: unknown) => Promise<{ ok: true } | { ok: false; error: string }>;
}) {
  const [qty, setQty] = useState(kgToTonnes(item.qtyKg));
  const [splitting, setSplitting] = useState(false);
  const [splitQty, setSplitQty] = useState("");
  const [splitProvider, setSplitProvider] = useState("");
  const ref = `#${item.orderId.slice(-4)}`;
  return (
    <li className="space-y-2 border-t border-border pt-3">
      <p className="text-sm">
        <Link href={`/distributor/orders/${item.orderId}`} className="font-semibold underline">Order {ref}</Link>
        {" "}{item.customerName}, ordered {kgToTonnes(item.orderQtyKg ?? 0)} t
      </p>
      <div className="flex items-end gap-2">
        <div className="flex-1">
          <Field id={`qty-${item.id}`} label={`Tonnes for order ${ref} in ${draftLabel}`} inputMode="decimal" value={qty} onChange={(e) => setQty(e.target.value)} />
        </div>
        <Button type="button" disabled={busy} className="border border-border bg-transparent text-text" onClick={() => void run(() => send(`/api/po-items/${item.id}`, "PATCH", { version, qtyTonnes: qty.trim() }))}>
          Save qty
        </Button>
        <Button type="button" disabled={busy} className="border border-border bg-transparent text-text" onClick={() => setSplitting((s) => !s)}>
          Split item
        </Button>
      </div>
      {splitting && (
        <div className="space-y-2 rounded-input border border-border p-3" role="group" aria-label={`Split order ${ref}`}>
          <Field id={`split-qty-${item.id}`} label="Tonnes to move to a new draft" inputMode="decimal" value={splitQty} onChange={(e) => setSplitQty(e.target.value)} />
          <label className="block space-y-1 text-sm font-semibold">
            Provider for the new draft
            <select className={SELECT} value={splitProvider} onChange={(e) => setSplitProvider(e.target.value)}>
              <option value="">Choose provider</option>
              {providers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <Button
            type="button"
            disabled={busy}
            onClick={() => void run(() => send(`/api/po-items/${item.id}/split`, "POST", { version, qtyTonnes: splitQty.trim(), providerId: splitProvider || null }))}
          >
            Split into new draft
          </Button>
        </div>
      )}
    </li>
  );
}
