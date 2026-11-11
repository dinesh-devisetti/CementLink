import Link from "next/link";
import { OrdersList } from "@/components/orders-list";
import { RoleShell } from "@/components/role-shell";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { listOrders } from "@/server/services/orders";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireRolePage("CUSTOMER");
  const { rows, total } = await listOrders(getDb(), user, { page: 1, limit: 50 });
  return (
    <RoleShell role="CUSTOMER" title="Orders" userName={user.name}>
      <Link href="/customer/orders/new" className="inline-flex min-h-11 items-center rounded-input bg-primary px-4 font-semibold text-primary-fg">
        New order
      </Link>
      <OrdersList orders={rows} total={total} role="CUSTOMER" />
    </RoleShell>
  );
}
