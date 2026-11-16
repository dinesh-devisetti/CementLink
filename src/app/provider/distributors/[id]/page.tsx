import { notFound } from "next/navigation";
import { InvoiceBalanceList, ReceiptList } from "@/components/payment-lists";
import { PoList } from "@/components/po-list";
import { RoleShell } from "@/components/role-shell";
import { formatPaise } from "@/lib/money";
import { poIdSchema } from "@/lib/validation/drafts";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { getProviderDistributorHeader } from "@/server/services/balances";
import { listPos } from "@/server/services/pos";
import { listInvoiceBalances, listProviderPayments } from "@/server/services/provider-payments";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRolePage("PROVIDER");
  const id = poIdSchema.safeParse((await params).id);
  if (!id.success) notFound();
  const db = getDb();
  try {
    const head = await getProviderDistributorHeader(db, user, id.data);
    const [pos, invoices, receipts] = await Promise.all([
      listPos(db, user, { excludeDraft: true, distributorId: id.data, page: 1, limit: 20 }),
      listInvoiceBalances(db, user, { counterpartyId: id.data }),
      listProviderPayments(db, user, { page: 1, limit: 20, counterpartyId: id.data }),
    ]);
    return (
      <RoleShell role="PROVIDER" title={head.counterparty} back={{ href: "/provider/distributors", label: "Distributors" }} userName={user.name}>
        <p className="tabular-nums" data-testid="distributor-outstanding">Outstanding {formatPaise(head.outstandingPaise)} (invoiced {formatPaise(head.invoicedPaise)}, paid {formatPaise(head.paidPaise)})</p>
        <h2 className="text-xl font-semibold">Orders</h2>
        <PoList pos={pos.rows} total={pos.total} role="PROVIDER" />
        <h2 className="text-xl font-semibold">Invoices</h2>
        <InvoiceBalanceList rows={invoices} empty="No invoices yet." />
        <h2 className="text-xl font-semibold">Receipts</h2>
        <ReceiptList rows={receipts.rows} total={receipts.total} empty="No receipts yet." label="Receipts" />
      </RoleShell>
    );
  } catch (e) {
    if (e instanceof AppError && e.httpStatus === 404) notFound();
    throw e;
  }
}
