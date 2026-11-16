import { BalanceSummary, ReceiptList } from "@/components/payment-lists";
import { RoleShell } from "@/components/role-shell";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { getBalances } from "@/server/services/balances";
import { listProviderPayments } from "@/server/services/provider-payments";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireRolePage("PROVIDER");
  const db = getDb();
  const [balances, receipts] = await Promise.all([getBalances(db, user), listProviderPayments(db, user, { page: 1, limit: 20 })]);
  return (
    <RoleShell role="PROVIDER" title="Payments" userName={user.name}>
      <p className="text-sm text-muted">Payments are recorded by the distributor. You can view them here but not change them.</p>
      <BalanceSummary balances={balances} title="Outstanding" empty="No invoices yet." href={(r) => `/provider/distributors/${r.counterpartyId}`} />
      <h2 className="text-xl font-semibold">Receipts</h2>
      <ReceiptList rows={receipts.rows} total={receipts.total} empty="No receipts yet." label="Receipts" />
    </RoleShell>
  );
}
