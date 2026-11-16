import { PaymentHistoryList } from "@/components/payment-history-list";
import { RoleShell } from "@/components/role-shell";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { listPayments } from "@/server/services/payments";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireRolePage("CUSTOMER");
  const { rows, total } = await listPayments(getDb(), user, { page: 1, limit: 50 });
  return (
    <RoleShell role="CUSTOMER" title="Payments" userName={user.name}>
      <PaymentHistoryList rows={rows} total={total} />
    </RoleShell>
  );
}
