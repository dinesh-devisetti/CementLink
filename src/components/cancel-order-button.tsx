"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button } from "./ui";

/** Cancel while REQUESTED, with an inline confirm step. */
export function CancelOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function cancel() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/orders/${orderId}/cancel`, { method: "POST" });
      if (res.ok) {
        router.refresh();
        return;
      }
      const j = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(j?.error ?? "Could not cancel, please retry");
    } catch {
      setError("Network error, please retry");
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <div className="space-y-2">
      {confirming ? (
        <div role="alertdialog" aria-label="Confirm cancel order" className="space-y-2">
          <p className="text-sm">Cancel this order? This cannot be undone.</p>
          <div className="flex gap-2">
            <Button type="button" disabled={busy} className="bg-danger text-primary-fg" onClick={cancel}>
              Confirm cancel
            </Button>
            <Button type="button" disabled={busy} className="border border-border bg-transparent text-text" onClick={() => setConfirming(false)}>
              Keep order
            </Button>
          </div>
        </div>
      ) : (
        <Button type="button" className="border border-border bg-transparent text-text" onClick={() => setConfirming(true)}>
          Cancel order
        </Button>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
