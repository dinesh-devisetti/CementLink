import Link from "next/link";
import { LogoutButton } from "@/components/logout-button";
import { RoleNav } from "@/components/role-nav";
import { ROLE_NAV, type NavRole } from "@/lib/nav";

/** Dashboard frame with the v2 role tabs (real links, aria-current from the route). */
export function RoleShell({
  role,
  title,
  userName,
  back,
  children,
}: {
  role: NavRole;
  title: string;
  userName: string;
  back?: { href: string; label: string };
  children?: React.ReactNode;
}) {
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4">
      <header className="flex items-center justify-between">
        <span className="font-semibold">CementLink</span>
        <LogoutButton />
      </header>
      <RoleNav items={ROLE_NAV[role]} />
      {back ? (
        <Link href={back.href} className="inline-flex min-h-11 items-center gap-1 rounded-input text-sm font-semibold text-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
          <span aria-hidden="true">←</span> {back.label}
        </Link>
      ) : null}
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted">Hello, {userName}</p>
      {children ?? <p className="rounded-card border border-border bg-surface p-4">No activity yet</p>}
    </main>
  );
}
