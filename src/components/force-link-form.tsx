"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { PartyOption } from "@/server/services/admin-users";
import { Button } from "./ui";

const label = (p: PartyOption) => `${p.businessName ?? p.name} (${p.role.toLowerCase()}${p.city ? `, ${p.city}` : ""})`;
const selectCls = "min-h-11 w-full rounded-input border border-border bg-surface px-3 text-base";

/** Admin "Link parties": provider+distributor or distributor+customer, created ACTIVE. */
export function ForceLinkForm({ parties }: { parties: PartyOption[] }) {
  const router = useRouter();
  const [upperId, setUpperId] = useState("");
  const [lowerId, setLowerId] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const uppers = parties.filter((p) => p.role === "PROVIDER" || p.role === "DISTRIBUTOR");
  const lowers = parties.filter((p) => p.role === "DISTRIBUTOR" || p.role === "CUSTOMER");

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch("/api/admin/links", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ upperId, lowerId }),
      });
      if (res.ok) {
        setMsg({ ok: true, text: "Linked. The link is active." });
        router.refresh();
      } else {
        const j = (await res.json().catch(() => null)) as { error?: string } | null;
        setMsg({ ok: false, text: j?.error ?? "Could not link, please retry" });
      }
    } catch {
      setMsg({ ok: false, text: "Network error, please retry" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-card border border-border bg-surface p-4">
      <div className="space-y-1">
        <label htmlFor="fl-upper" className="text-sm font-semibold">Supplier (provider or distributor)</label>
        <select id="fl-upper" value={upperId} onChange={(e) => setUpperId(e.target.value)} className={selectCls}>
          <option value="">Choose...</option>
          {uppers.map((p) => (
            <option key={p.id} value={p.id}>{label(p)}</option>
          ))}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor="fl-lower" className="text-sm font-semibold">Buyer (distributor or customer)</label>
        <select id="fl-lower" value={lowerId} onChange={(e) => setLowerId(e.target.value)} className={selectCls}>
          <option value="">Choose...</option>
          {lowers.map((p) => (
            <option key={p.id} value={p.id}>{label(p)}</option>
          ))}
        </select>
      </div>
      {msg && (
        <p role={msg.ok ? "status" : "alert"} className={msg.ok ? "text-sm text-success" : "text-sm text-danger"}>
          {msg.text}
        </p>
      )}
      <Button type="submit" disabled={busy || !upperId || !lowerId}>Link parties</Button>
    </form>
  );
}
