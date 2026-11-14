"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { sendJson } from "@/lib/client-api";
import { Button } from "./ui";

/** Distributor confirms the dispatched order reached the customer. */
export function DeliverOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function deliver() {
    setBusy(true);
    setError(null);
    const r = await sendJson(`/api/orders/${orderId}/deliver`, "POST");
    setBusy(false);
    setConfirming(false);
    if (r.ok) router.refresh();
    else setError(r.error);
  }
  return (
    <div className="space-y-2">
      {confirming ? (
        <div role="alertdialog" aria-label="Confirm delivered" className="space-y-2">
          <p className="text-sm">Confirm the customer has received this order?</p>
          <div className="flex gap-2">
            <Button type="button" disabled={busy} onClick={deliver}>Confirm delivered</Button>
            <Button type="button" disabled={busy} className="border border-border bg-transparent text-text" onClick={() => setConfirming(false)}>Not yet</Button>
          </div>
        </div>
      ) : (
        <Button type="button" onClick={() => setConfirming(true)}>Mark delivered</Button>
      )}
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
