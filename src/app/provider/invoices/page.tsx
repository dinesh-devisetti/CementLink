import { ProviderInvoiceList } from "@/components/provider-invoice-list";
import { RoleShell } from "@/components/role-shell";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { listProviderInvoices } from "@/server/services/provider-invoices";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireRolePage("PROVIDER");
  const { rows, total } = await listProviderInvoices(getDb(), user, { page: 1, limit: 50 });
  return (
    <RoleShell role="PROVIDER" title="Invoices" userName={user.name}>
      <p className="text-sm text-muted">To invoice a purchase order, open it from Orders once it is dispatched.</p>
      <ProviderInvoiceList rows={rows} total={total} poHref={(id) => `/provider/orders/${id}`} />
    </RoleShell>
  );
}
