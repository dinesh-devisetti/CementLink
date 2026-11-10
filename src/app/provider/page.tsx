import { LogoutButton } from "@/components/logout-button";
import { ProviderOrders } from "@/components/provider-orders";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { listPos, providerSummary } from "@/server/services/pos";

export const dynamic = "force-dynamic";

export default async function ProviderDashboard() {
  const user = await requireRolePage("PROVIDER");
  const db = getDb();
  const [{ rows, total }, summary] = await Promise.all([
    listPos(db, { id: user.id, role: "PROVIDER" }, { page: 1, limit: 50 }),
    providerSummary(db, user.id),
  ]);
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4">
      <header className="flex items-center justify-between">
        <span className="font-semibold">CementLink</span>
        <LogoutButton />
      </header>
      <h1 className="text-2xl font-semibold">Provider dashboard</h1>
      <p className="text-muted">Hello, {user.name}</p>
      <section className="grid grid-cols-2 gap-3" aria-label="Order summary">
        <div className="rounded-card border border-border bg-surface p-4">
          <p className="text-sm text-muted">Orders received</p>
          <p className="font-semibold tabular-nums" data-testid="orders-received">
            {summary.ordersReceived}
          </p>
        </div>
        <div className="rounded-card border border-border bg-surface p-4">
          <p className="text-sm text-muted">Awaiting reply</p>
          <p className="font-semibold tabular-nums">{summary.awaitingReply}</p>
        </div>
      </section>
      <h2 className="text-xl font-semibold">Orders received</h2>
      <ProviderOrders rows={rows} />
      {total > rows.length && <p className="text-sm text-muted">Showing {rows.length} of {total}</p>}
    </main>
  );
}
