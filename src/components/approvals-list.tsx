"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { AdminUserRow } from "@/server/services/admin-users";
import { Button } from "./ui";

export type PendingRow = Pick<AdminUserRow, "id" | "name" | "email" | "role" | "businessName" | "city" | "createdAt">;

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

export function ApprovalsList({ rows }: { rows: PendingRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function decide(id: string, action: "approve" | "reject") {
    setBusyId(id);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(id)}/${action}`, { method: "POST" });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "Could not update the account, please retry");
        return;
      }
      router.refresh();
    } catch {
      setError("Network error, please retry");
    } finally {
      setBusyId(null);
    }
  }

  if (rows.length === 0) return <p className="text-muted">No accounts are waiting for approval.</p>;
  return (
    <div className="space-y-3">
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-col gap-3 rounded-card border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">
                {r.name} <span className="text-sm font-normal text-muted">({r.role.toLowerCase()})</span>
              </p>
              <p className="text-sm text-muted">
                {r.email}
                {r.businessName ? ` · ${r.businessName}` : ""}
                {r.city ? ` · ${r.city}` : ""} · {dateFmt.format(r.createdAt)}
              </p>
            </div>
            <div className="flex gap-2">
              <Button type="button" disabled={busyId === r.id} aria-label={`Approve ${r.name}`} onClick={() => decide(r.id, "approve")}>
                Approve
              </Button>
              <Button
                type="button"
                disabled={busyId === r.id}
                aria-label={`Reject ${r.name}`}
                className="border border-border bg-transparent text-text"
                onClick={() => decide(r.id, "reject")}
              >
                Reject
              </Button>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
