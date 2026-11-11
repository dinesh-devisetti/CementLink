import { OrdersList } from "@/components/orders-list";
import { RoleShell } from "@/components/role-shell";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { listOrders } from "@/server/services/orders";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireRolePage("DISTRIBUTOR");
  const { rows, total } = await listOrders(getDb(), user, { page: 1, limit: 50 });
  return (
    <RoleShell role="DISTRIBUTOR" title="Orders" userName={user.name}>
      <OrdersList orders={rows} total={total} role="DISTRIBUTOR" />
    </RoleShell>
  );
}
