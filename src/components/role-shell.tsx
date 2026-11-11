import { LogoutButton } from "@/components/logout-button";
import { RoleNav } from "@/components/role-nav";
import { ROLE_NAV, type NavRole } from "@/lib/nav";

/** Dashboard frame with the v2 role tabs (real links, aria-current from the route). */
export function RoleShell({
  role,
  title,
  userName,
  children,
}: {
  role: NavRole;
  title: string;
  userName: string;
  children?: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4">
      <header className="flex items-center justify-between">
        <span className="font-semibold">CementLink</span>
        <LogoutButton />
      </header>
      <RoleNav items={ROLE_NAV[role]} />
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted">Hello, {userName}</p>
      {children ?? <p className="rounded-card border border-border bg-surface p-4">No activity yet</p>}
    </main>
  );
}
