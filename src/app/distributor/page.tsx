import Link from "next/link";
import { DistributorLines } from "@/components/distributor-lines";
import { LogoutButton } from "@/components/logout-button";
import { bagsToTonnes } from "@/lib/qty";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { demandSummary, listLines } from "@/server/services/lines";
import { unfulfilledBags } from "@/server/services/pos";

export const dynamic = "force-dynamic";

export default async function DistributorDashboard() {
  const user = await requireRolePage("DISTRIBUTOR");
  const db = getDb();
  const [{ rows, total }, summary, open] = await Promise.all([
    listLines(db, user.id, { page: 1, limit: 50 }),
    demandSummary(db, user.id),
    unfulfilledBags(db, user.id),
  ]);
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4">
      <header className="flex items-center justify-between">
        <span className="font-semibold">CementLink</span>
        <LogoutButton />
      </header>
      <h1 className="text-2xl font-semibold">Distributor dashboard</h1>
      <p className="text-muted">Hello, {user.name}</p>
      <section className="grid grid-cols-2 gap-3" aria-label="Demand summary">
        <div className="rounded-card border border-border bg-surface p-4">
          <p className="text-sm text-muted">Accepted demand</p>
          <p className="font-semibold tabular-nums" data-testid="accepted-demand">
            {summary.acceptedBags} bags ({bagsToTonnes(summary.acceptedBags)} t)
          </p>
        </div>
        <div className="rounded-card border border-border bg-surface p-4">
          <p className="text-sm text-muted">Awaiting reply</p>
          <p className="font-semibold tabular-nums">{summary.awaitingReply}</p>
        </div>
        <div className="rounded-card border border-border bg-surface p-4">
          <p className="text-sm text-muted">Unfulfilled vs POs</p>
          <p className="font-semibold tabular-nums" data-testid="unfulfilled">
            {Math.max(0, open)} bags
          </p>
        </div>
      </section>
      <Link href="/distributor/orders" className="inline-block min-h-11 py-2 text-sm font-semibold text-primary underline">
        Purchase orders
      </Link>
      <h2 className="text-xl font-semibold">Requests</h2>
      <DistributorLines rows={rows} />
      {total > rows.length && <p className="text-sm text-muted">Showing {rows.length} of {total}</p>}
    </main>
  );
}
