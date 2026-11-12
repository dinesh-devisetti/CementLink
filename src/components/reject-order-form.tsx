"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { sendJson } from "@/lib/client-api";
import { Button, Field } from "./ui";

/** Distributor rejects an order that has no placed PO yet; a reason is required. */
export function RejectOrderForm({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const r = await sendJson(`/api/orders/${orderId}/reject`, "POST", { reason });
    setBusy(false);
    if (r.ok) router.refresh();
    else setError(r.error);
  }

  if (!open) {
    return <Button type="button" className="border border-border bg-transparent text-text" onClick={() => setOpen(true)}>Reject order</Button>;
  }
  return (
    <form onSubmit={submit} className="space-y-2" aria-label="Reject order">
      <Field id="reject-reason" label="Reason for rejecting" value={reason} maxLength={300} required onChange={(e) => setReason(e.target.value)} />
      <div className="flex gap-2">
        <Button type="submit" disabled={busy || reason.trim() === ""} className="bg-danger text-primary-fg">Confirm reject</Button>
        <Button type="button" disabled={busy} className="border border-border bg-transparent text-text" onClick={() => setOpen(false)}>Keep order</Button>
      </div>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </form>
  );
}
