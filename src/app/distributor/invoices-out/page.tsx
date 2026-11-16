import { CustomerInvoiceList } from "@/components/customer-invoice-list";
import { RoleShell } from "@/components/role-shell";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { listCustomerInvoices } from "@/server/services/customer-invoices";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireRolePage("DISTRIBUTOR");
  const { rows, total } = await listCustomerInvoices(getDb(), user, { page: 1, limit: 50 });
  return (
    <RoleShell role="DISTRIBUTOR" title="Invoices out" userName={user.name}>
      <CustomerInvoiceList rows={rows} total={total} role="DISTRIBUTOR" empty="No customer invoices yet. Mark an order delivered, then create its invoice from the order page." />
    </RoleShell>
  );
}
