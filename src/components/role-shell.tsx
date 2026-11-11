import { LogoutButton } from "@/components/logout-button";
import { cn } from "@/components/ui";

export const ROLE_NAV = {
  CUSTOMER: ["Orders", "Distributors", "Invoices", "Pay"],
  DISTRIBUTOR: ["Orders", "Providers", "Customers", "Purchase orders", "Invoices in", "Payments"],
  PROVIDER: ["Orders", "Distributors", "Invoices", "Payments"],
  ADMIN: ["Approvals", "Distributors", "Customers", "Transport"],
} as const;

type Role = keyof typeof ROLE_NAV;

/** Dashboard frame with the v2 navigation. Tabs without a built page yet render as inactive labels. */
export function RoleShell({
  role,
  title,
  userName,
  children,
  live = [],
}: {
  role: Role;
  title: string;
  userName: string;
  children?: React.ReactNode;
  live?: readonly string[];
}) {
  const items: readonly string[] = ROLE_NAV[role];
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4">
      <header className="flex items-center justify-between">
        <span className="font-semibold">CementLink</span>
        <LogoutButton />
      </header>
      <nav aria-label="Sections" className="flex gap-2 overflow-x-auto">
        {items.map((label, i) => (
          <span
            key={label}
            aria-current={i === 0 ? "page" : undefined}
            aria-disabled={live.includes(label) ? undefined : true}
            className={cn(
              "inline-flex min-h-11 items-center whitespace-nowrap rounded-input border border-border px-3 text-sm font-semibold",
              i === 0 ? "bg-primary text-primary-fg" : "text-muted",
            )}
          >
            {label}
          </span>
        ))}
      </nav>
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="text-muted">Hello, {userName}</p>
      {children ?? <p className="rounded-card border border-border bg-surface p-4">No activity yet</p>}
    </main>
  );
}
