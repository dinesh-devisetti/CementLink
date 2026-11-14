"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { sendJson } from "@/lib/client-api";
import { combineBlockReason, placeBlockReason } from "@/lib/draft-rules";
import type { PoView } from "@/server/services/pos";
import { DraftCard, type ProviderOption } from "./draft-card";
import { Button } from "./ui";

/**
 * Draft-PO review (S4). Place stays disabled, with the reason as visible text, while a selected draft has no
 * provider or an order's drafts do not add up to its quantity. Every edit re-reads the page; 409 STALE shows the server text.
 */
export function DraftPanel({ drafts, providers }: { drafts: PoView[]; providers: ProviderOption[] }) {
  const router = useRouter();
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const chosen = drafts.filter((d) => selected.has(d.id));
  const reason = placeBlockReason(chosen);
  const combineReason = combineBlockReason(chosen);

  async function run(fn: () => Promise<{ ok: true } | { ok: false; error: string }>) {
    setBusy(true);
    setError(null);
    const r = await fn();
    setBusy(false);
    setConfirming(false);
    if (!r.ok) setError(r.error);
    router.refresh();
  }

  const toggle = (id: string) => setSelected((s) => (s.has(id) ? new Set([...s].filter((x) => x !== id)) : new Set([...s, id])));

  if (drafts.length === 0) {
    return <p className="rounded-card border border-border bg-surface p-4">No drafts. Open a customer order to create drafts.</p>;
  }
  return (
    <section aria-label="Drafts" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-xl font-semibold">Drafts ({drafts.length})</h2>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={busy || combineReason !== null}
            className="border border-border bg-transparent text-text"
            onClick={() => void run(async () => {
              const r = await sendJson("/api/pos/combine", "POST", { pos: chosen.map((d) => ({ id: d.id, version: d.version ?? 0 })) });
              if (r.ok) setSelected(new Set());
              return r;
            })}
          >
            Combine selected ({chosen.length})
          </Button>
          <Button type="button" disabled={busy || reason !== null} onClick={() => setConfirming(true)}>
            Place selected ({chosen.length})
          </Button>
        </div>
      </div>
      {combineReason && <p role="status" className="text-sm text-muted">Combine: {combineReason}</p>}
      {reason && <p role="status" className="text-sm text-muted">{reason}</p>}
      {confirming && (
        <div role="alertdialog" aria-label="Confirm place" className="space-y-2 rounded-card border border-border bg-surface p-4">
          <p>Place {chosen.length} {chosen.length === 1 ? "PO" : "POs"}? Providers will see them.</p>
          <div className="flex gap-2">
            <Button type="button" disabled={busy} onClick={() => void run(() => sendJson("/api/pos/place", "POST", { pos: chosen.map((d) => ({ id: d.id, version: d.version ?? 0 })) }))}>
              Confirm place
            </Button>
            <Button type="button" disabled={busy} className="border border-border bg-transparent text-text" onClick={() => setConfirming(false)}>
              Keep editing
            </Button>
          </div>
        </div>
      )}
      {error && <p role="alert" className="rounded-input border border-danger p-3 text-sm text-danger">{error}</p>}
      <ul className="space-y-3">
        {drafts.map((d, i) => (
          <DraftCard key={`${d.id}-${d.version}`} draft={d} index={i} providers={providers} selected={selected.has(d.id)} onToggle={() => toggle(d.id)} run={run} send={sendJson} busy={busy} />
        ))}
      </ul>
    </section>
  );
}
