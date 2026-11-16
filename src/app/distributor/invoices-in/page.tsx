import { ProviderInvoiceList } from "@/components/provider-invoice-list";
import { RoleShell } from "@/components/role-shell";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { listProviderInvoices } from "@/server/services/provider-invoices";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireRolePage("DISTRIBUTOR");
  const { rows, total } = await listProviderInvoices(getDb(), user, { page: 1, limit: 50 });
  return (
    <RoleShell role="DISTRIBUTOR" title="Invoices in" userName={user.name}>
      <ProviderInvoiceList rows={rows} total={total} empty="No provider invoices yet." poHref={(id) => `/distributor/pos/${id}?from=all`} />
    </RoleShell>
  );
}
