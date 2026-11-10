import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";
import { RequestCard } from "@/components/request-card";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { listRequests } from "@/server/services/requests";

export const dynamic = "force-dynamic";

export default async function CustomerDashboard() {
  const user = await requireRolePage("CUSTOMER");
  const { rows, total } = await listRequests(getDb(), user.id, { page: 1, limit: 20 });
  return (
    <main className="mx-auto max-w-lg space-y-4 p-4">
      <header className="flex items-center justify-between">
        <span className="font-semibold">CementLink</span>
        <LogoutButton />
      </header>
      <h1 className="text-2xl font-semibold">Customer dashboard</h1>
      <p className="text-muted">Hello, {user.name}</p>
      <Link
        href="/customer/new"
        className="inline-flex min-h-11 w-full items-center justify-center rounded-input bg-primary px-4 font-semibold text-primary-fg"
      >
        + New request
      </Link>
      <h2 className="text-xl font-semibold">Requests</h2>
      {rows.length === 0 ? (
        <p className="rounded-card border border-border bg-surface p-4">No requests yet</p>
      ) : (
        <div className="space-y-3">
          {rows.map((r) => (
            <RequestCard key={r.id} request={r} />
          ))}
          {total > rows.length && <p className="text-sm text-muted">Showing {rows.length} of {total}</p>}
        </div>
      )}
    </main>
  );
}
