import { NewOrderForm } from "@/components/new-order-form";
import { RoleShell } from "@/components/role-shell";
import { todayIst } from "@/lib/dates";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { listLinks } from "@/server/services/links";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireRolePage("CUSTOMER");
  const { rows } = await listLinks(getDb(), user, { kind: "DISTRIBUTOR_CUSTOMER", page: 1, limit: 50 });
  const distributors = rows.filter((l) => l.status === "ACTIVE").map((l) => ({ id: l.counterpart.id, name: l.counterpart.businessName }));
  return (
    <RoleShell role="CUSTOMER" title="New order" userName={user.name}>
      <NewOrderForm distributors={distributors} today={todayIst()} />
    </RoleShell>
  );
}
