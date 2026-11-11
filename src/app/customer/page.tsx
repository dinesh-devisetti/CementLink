import { RoleShell } from "@/components/role-shell";
import { requireRolePage } from "@/server/auth/guards";

export const dynamic = "force-dynamic";

export default async function CustomerDashboard() {
  const user = await requireRolePage("CUSTOMER");
  return <RoleShell role="CUSTOMER" title="Customer dashboard" userName={user.name} />;
}
