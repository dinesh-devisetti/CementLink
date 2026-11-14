"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { sendJson } from "@/lib/client-api";
import { Button, Field } from "./ui";

const OUTLINE = "border border-border bg-transparent text-text";

/** Runs one provider action, refreshes the page on success and shows the server's message otherwise. */
function useAction(poId: string) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function run(path: string, body?: unknown): Promise<boolean> {
    setBusy(true);
    setError(null);
    const r = await sendJson(`/api/pos/${poId}/${path}`, "POST", body);
    setBusy(false);
    if (r.ok) router.refresh();
    else setError(r.error);
    return r.ok;
  }
  return { busy, error, run };
}

const ErrorLine = ({ error }: { error: string | null }) => (error ? <p role="alert" className="text-sm text-danger">{error}</p> : null);

/** PLACED: accept or reject (reason required, confirm step). */
export function AcceptRejectPanel({ poId }: { poId: string }) {
  const { busy, error, run } = useAction(poId);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  if (rejecting) {
    return (
      <form
        aria-label="Reject purchase order"
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void run("reject", { reason });
        }}
      >
        <Field id="po-reject-reason" label="Reason for rejecting" value={reason} maxLength={300} required onChange={(e) => setReason(e.target.value)} />
        <div className="flex gap-2">
          <Button type="submit" disabled={busy || reason.trim() === ""} className="bg-danger text-primary-fg">Confirm reject</Button>
          <Button type="button" disabled={busy} className={OUTLINE} onClick={() => setRejecting(false)}>Keep purchase order</Button>
        </div>
        <ErrorLine error={error} />
      </form>
    );
  }
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Button type="button" disabled={busy} onClick={() => void run("accept")}>Accept</Button>
        <Button type="button" disabled={busy} className={OUTLINE} onClick={() => setRejecting(true)}>Reject</Button>
      </div>
      <ErrorLine error={error} />
    </div>
  );
}

/** ACCEPTED: dispatch form. The date is limited to the order date through today (IST); the server re-checks. */
export function DispatchForm({ poId, today, placedOn }: { poId: string; today: string; placedOn: string }) {
  const { busy, error, run } = useAction(poId);
  const [dispatchDate, setDate] = useState(today);
  const [vehicleNo, setVehicle] = useState("");
  const [driverPhone, setPhone] = useState("");
  return (
    <form
      aria-label="Dispatch purchase order"
      className="space-y-3 rounded-card border border-border bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void run("dispatch", { dispatchDate, vehicleNo, driverPhone });
      }}
    >
      <h2 className="text-xl font-semibold">Dispatch</h2>
      <Field id="dispatch-date" type="date" label="Dispatch date" value={dispatchDate} min={placedOn} max={today} required onChange={(e) => setDate(e.target.value)} />
      <Field id="dispatch-vehicle" label="Vehicle number (optional)" value={vehicleNo} maxLength={16} autoCapitalize="characters" onChange={(e) => setVehicle(e.target.value)} />
      <Field id="dispatch-phone" label="Driver phone (optional)" inputMode="numeric" value={driverPhone} maxLength={10} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ""))} />
      <Button type="submit" disabled={busy || dispatchDate === ""}>Mark dispatched</Button>
      <ErrorLine error={error} />
    </form>
  );
}
