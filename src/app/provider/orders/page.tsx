import { PoList } from "@/components/po-list";
import { RoleShell } from "@/components/role-shell";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { listPos } from "@/server/services/pos";

export const dynamic = "force-dynamic";

export default async function Page() {
  const user = await requireRolePage("PROVIDER");
  const { rows, total } = await listPos(getDb(), user, { page: 1, limit: 50 });
  return (
    <RoleShell role="PROVIDER" title="Orders" userName={user.name}>
      <PoList pos={rows} total={total} role="PROVIDER" />
    </RoleShell>
  );
}
