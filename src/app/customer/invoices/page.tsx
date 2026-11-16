import { CustomerInvoiceList } from "@/components/customer-invoice-list";
import { RoleShell } from "@/components/role-shell";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { listCustomerInvoices } from "@/server/services/customer-invoices";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireRolePage("CUSTOMER");
  const { rows, total } = await listCustomerInvoices(getDb(), user, { page: 1, limit: 50 });
  return (
    <RoleShell role="CUSTOMER" title="Invoices" userName={user.name}>
      <CustomerInvoiceList rows={rows} total={total} role="CUSTOMER" empty="No invoices yet. Your distributor invoices an order after delivery." />
    </RoleShell>
  );
}
