import { DistributorAnalyticsView, FilterBar, Pager } from "@/components/admin-analytics-views";
import { RoleShell } from "@/components/role-shell";
import { pageParam } from "@/lib/page-param";
import { parseAnalyticsFilters } from "@/lib/validation/admin-analytics";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { getDistributorAnalytics } from "@/server/services/analytics";

export const dynamic = "force-dynamic";
const LIMIT = 20;

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireRolePage("ADMIN");
  const sp = await searchParams;
  const page = pageParam(typeof sp.page === "string" ? sp.page : undefined);
  const filters = parseAnalyticsFilters(sp);
  const data = await getDistributorAnalytics(getDb(), user, { page, limit: LIMIT }, undefined, filters);
  return (
    <RoleShell role="ADMIN" title="Distributors" userName={user.name}>
      <FilterBar base="/admin/distributors" filters={filters} searchLabel="Search distributors (name, city)" />
      <DistributorAnalyticsView data={data} />
      <Pager base="/admin/distributors" page={page} limit={LIMIT} total={data.total} filters={filters} />
    </RoleShell>
  );
}
