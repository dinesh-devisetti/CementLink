import { RoleShell } from "@/components/role-shell";
import { requireRolePage } from "@/server/auth/guards";

export const dynamic = "force-dynamic";

export default async function DistributorDashboard() {
  const user = await requireRolePage("DISTRIBUTOR");
  return <RoleShell role="DISTRIBUTOR" title="Distributor dashboard" userName={user.name} />;
}
