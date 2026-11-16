"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { sendJson } from "@/lib/client-api";
import { Button } from "./ui";

/** Distributor asks the customer to pay an ISSUED invoice. */
export function SendPaymentRequestButton({ invoiceId }: { invoiceId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function send() {
    setBusy(true);
    setError(null);
    const r = await sendJson(`/api/customer-invoices/${encodeURIComponent(invoiceId)}/payment-request`, "POST");
    setBusy(false);
    if (r.ok) router.refresh();
    else setError(r.error);
  }
  return (
    <div className="space-y-1">
      <Button type="button" disabled={busy} onClick={send}>Send payment request</Button>
      {error && <p role="alert" className="text-sm text-danger">{error}</p>}
    </div>
  );
}
