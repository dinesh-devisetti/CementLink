import { DispatchTable, FilterBar, Pager } from "@/components/admin-analytics-views";
import { RoleShell } from "@/components/role-shell";
import { pageParam } from "@/lib/page-param";
import { parseAnalyticsFilters } from "@/lib/validation/admin-analytics";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { listAdminDispatches } from "@/server/services/analytics";

export const dynamic = "force-dynamic";
const LIMIT = 20;

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRolePage("ADMIN");
  const sp = await searchParams;
  const page = pageParam(typeof sp.page === "string" ? sp.page : undefined);
  const filters = parseAnalyticsFilters(sp);
  const { rows, total } = await listAdminDispatches(getDb(), user, { page, limit: LIMIT }, filters);
  return (
    <RoleShell role="ADMIN" title="Transport" userName={user.name}>
      <FilterBar base="/admin/transport" filters={filters} searchLabel="Search (distributor, provider, vehicle, driver)" />
      <DispatchTable rows={rows} />
      <Pager base="/admin/transport" page={page} limit={LIMIT} total={total} filters={filters} />
    </RoleShell>
  );
}
