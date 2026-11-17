import { CustomerTable, Pager } from "@/components/admin-analytics-views";
import { RoleShell } from "@/components/role-shell";
import { pageParam } from "@/lib/page-param";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { listAdminCustomers } from "@/server/services/analytics";

export const dynamic = "force-dynamic";
const LIMIT = 20;

export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await requireRolePage("ADMIN");
  const page = pageParam((await searchParams).page);
  const { rows, total } = await listAdminCustomers(getDb(), user, { page, limit: LIMIT });
  return (
    <RoleShell role="ADMIN" title="Customers" userName={user.name}>
      <CustomerTable rows={rows} />
      <Pager base="/admin/customers" page={page} limit={LIMIT} total={total} />
    </RoleShell>
  );
}
