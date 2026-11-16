import { BalanceSummary, InvoiceBalanceList, ReceiptList } from "@/components/payment-lists";
import { ProviderPaymentForm } from "@/components/provider-payment-form";
import { RoleShell } from "@/components/role-shell";
import { todayIst } from "@/lib/dates";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { getBalances } from "@/server/services/balances";
import { listInvoiceBalances, listProviderPayments } from "@/server/services/provider-payments";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireRolePage("DISTRIBUTOR");
  const db = getDb();
  const [balances, payable, paid] = await Promise.all([getBalances(db, user), listInvoiceBalances(db, user, { onlyOutstanding: true }), listProviderPayments(db, user, { page: 1, limit: 20 })]);
  const today = todayIst();
  return (
    <RoleShell role="DISTRIBUTOR" title="Payments" userName={user.name}>
      <BalanceSummary balances={balances} title="Payable to providers" empty="Nothing payable yet." />
      <h2 className="text-xl font-semibold">Invoices to pay</h2>
      <InvoiceBalanceList rows={payable} empty="No unpaid provider invoices.">
        {(r) => <ProviderPaymentForm invoiceId={r.id} invoiceNo={r.invoiceNo} invoiceDate={r.invoiceDate} outstandingPaise={r.outstandingPaise} today={today} />}
      </InvoiceBalanceList>
      <h2 className="text-xl font-semibold">Payments made</h2>
      <ReceiptList rows={paid.rows} total={paid.total} empty="No payments recorded yet." label="Payments made" />
    </RoleShell>
  );
}
