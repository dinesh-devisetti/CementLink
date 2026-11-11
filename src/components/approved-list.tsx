"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PendingRow } from "./approvals-list";
import { Button } from "./ui";

/** ACTIVE distributors/providers with Revoke (admin reject of an ACTIVE user; ends their sessions). */
export function ApprovedList({ rows }: { rows: PendingRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function revoke(id: string) {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}/reject`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not revoke the account, please retry");
        return;
      }
      setConfirming(null);
      router.refresh();
    } catch {
      setError("Network error, please retry");
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) return <p className="text-muted">No approved accounts yet.</p>;
  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col gap-2 rounded-card border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="font-semibold">
              {r.businessName ?? r.name} <span className="text-sm font-normal text-muted">({r.role.toLowerCase()}{r.city ? `, ${r.city}` : ""})</span>
            </p>
            {confirming === r.id ? (
              <div role="alertdialog" aria-label={`Confirm revoke ${r.name}`} className="space-y-2">
                <p className="text-sm">They are signed out and lose access until re-approved.</p>
                <div className="flex gap-2">
                  <Button type="button" disabled={busyId === r.id} className="bg-danger text-primary-fg" onClick={() => revoke(r.id)}>
                    Confirm revoke
                  </Button>
                  <Button type="button" className="border border-border bg-transparent text-text" onClick={() => setConfirming(null)}>
                    Keep account
                  </Button>
                </div>
              </div>
            ) : (
              <Button type="button" aria-label={`Revoke access ${r.name}`} className="border border-border bg-transparent text-text" onClick={() => setConfirming(r.id)}>
                Revoke access
              </Button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
