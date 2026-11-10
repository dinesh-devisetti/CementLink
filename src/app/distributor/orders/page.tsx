import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";
import { PoManager } from "@/components/po-manager";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { listActiveProviders, listPos, unfulfilledBags } from "@/server/services/pos";

export const dynamic = "force-dynamic";

export default async function DistributorOrders() {
  const user = await requireRolePage("DISTRIBUTOR");
  const db = getDb();
  const [providers, { rows, total }, open] = await Promise.all([
    listActiveProviders(db),
    listPos(db, { id: user.id, role: "DISTRIBUTOR" }, { page: 1, limit: 50 }),
    unfulfilledBags(db, user.id),
  ]);
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4">
      <header className="flex items-center justify-between">
        <span className="font-semibold">CementLink</span>
        <LogoutButton />
      </header>
      <Link href="/distributor" className="inline-block min-h-11 py-2 text-sm font-semibold text-primary underline">
        Back to requests
      </Link>
      <h1 className="text-2xl font-semibold">Purchase orders</h1>
      <PoManager providers={providers} rows={rows} unfulfilledBags={open} />
      {total > rows.length && <p className="text-sm text-muted">Showing {rows.length} of {total}</p>}
    </main>
  );
}
