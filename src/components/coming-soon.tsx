import { notFound } from "next/navigation";
import { RoleShell } from "@/components/role-shell";
import { BUILT_HREFS, ROLE_NAV, type NavRole } from "@/lib/nav";
import { requireRolePage } from "@/server/auth/guards";

/** Page body for a role tab that is not built yet. Unknown or built slugs 404. */
export async function ComingSoonPage({ role, section }: { role: NavRole; section: string }) {
  const user = await requireRolePage(role);
  const item = ROLE_NAV[role].find((i) => i.href === `/${role.toLowerCase()}/${section}`);
  if (!item || BUILT_HREFS.has(item.href)) notFound();
  return (
    <RoleShell role={role} title={item.label} userName={user.name}>
      <p className="rounded-card border border-border bg-surface p-4">Coming in a later release.</p>
    </RoleShell>
  );
}
