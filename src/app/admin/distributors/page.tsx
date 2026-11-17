import { DistributorAnalyticsView, Pager } from "@/components/admin-analytics-views";
import { RoleShell } from "@/components/role-shell";
import { pageParam } from "@/lib/page-param";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { getDistributorAnalytics } from "@/server/services/analytics";

export const dynamic = "force-dynamic";
const LIMIT = 20;

export default async function Page({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  const user = await requireRolePage("ADMIN");
  const page = pageParam((await searchParams).page);
  const data = await getDistributorAnalytics(getDb(), user, { page, limit: LIMIT });
  return (
    <RoleShell role="ADMIN" title="Distributors" userName={user.name}>
      <DistributorAnalyticsView data={data} />
      <Pager base="/admin/distributors" page={page} limit={LIMIT} total={data.total} />
    </RoleShell>
  );
}
