import { RoleShell } from "@/components/role-shell";
import { requireRolePage } from "@/server/auth/guards";

export const dynamic = "force-dynamic";

export default async function ProviderDashboard() {
  const user = await requireRolePage("PROVIDER");
  return <RoleShell role="PROVIDER" title="Provider dashboard" userName={user.name} />;
}
