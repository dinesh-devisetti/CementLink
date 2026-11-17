import { notFound } from "next/navigation";
import { CustomerOrders, Pager } from "@/components/admin-analytics-views";
import { RoleShell } from "@/components/role-shell";
import { pageParam } from "@/lib/page-param";
import { userIdSchema } from "@/lib/validation/admin";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { getAdminCustomer } from "@/server/services/analytics";

export const dynamic = "force-dynamic";
const LIMIT = 20;

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ page?: string }> }) {
  const user = await requireRolePage("ADMIN");
  const id = userIdSchema.safeParse((await params).id);
  if (!id.success) notFound();
  const page = pageParam((await searchParams).page);
  try {
    const detail = await getAdminCustomer(getDb(), user, id.data, { page, limit: LIMIT });
    return (
      <RoleShell role="ADMIN" title={detail.customer} back={{ href: "/admin/customers", label: "Customers" }} userName={user.name}>
        <CustomerOrders detail={detail} />
        <Pager base={`/admin/customers/${id.data}`} page={page} limit={LIMIT} total={detail.total} />
      </RoleShell>
    );
  } catch (e) {
    if (e instanceof AppError && e.httpStatus === 404) notFound();
    throw e;
  }
}
