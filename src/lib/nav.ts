export type NavRole = "CUSTOMER" | "DISTRIBUTOR" | "PROVIDER" | "ADMIN";
export interface NavItem {
  label: string;
  href: string;
}

/** Role tabs from 02-design.md (page routes). Edge-safe: used by server pages and the client nav. */
export const ROLE_NAV: Record<NavRole, readonly NavItem[]> = {
  CUSTOMER: [
    { label: "Orders", href: "/customer/orders" },
    { label: "Distributors", href: "/customer/distributors" },
    { label: "Invoices", href: "/customer/invoices" },
    { label: "Pay", href: "/customer/payments" },
  ],
  DISTRIBUTOR: [
    { label: "Orders", href: "/distributor/orders" },
    { label: "Providers", href: "/distributor/providers" },
    { label: "Customers", href: "/distributor/customers" },
    { label: "Purchase orders", href: "/distributor/pos" },
    { label: "Invoices in", href: "/distributor/invoices-in" },
    { label: "Invoices out", href: "/distributor/invoices-out" },
    { label: "Payments", href: "/distributor/payments" },
  ],
  PROVIDER: [
    { label: "Orders", href: "/provider/orders" },
    { label: "Distributors", href: "/provider/distributors" },
    { label: "Invoices", href: "/provider/invoices" },
    { label: "Payments", href: "/provider/payments" },
  ],
  ADMIN: [
    { label: "Approvals", href: "/admin/approvals" },
    { label: "Distributors", href: "/admin/distributors" },
    { label: "Customers", href: "/admin/customers" },
    { label: "Transport", href: "/admin/transport" },
  ],
};

/** Tabs whose page is built; every other tab opens the "Coming in a later release" page. */
export const BUILT_HREFS: ReadonlySet<string> = new Set([
  "/customer/orders",
  "/distributor/orders",
  "/distributor/pos",
  "/provider/orders",
  "/provider/invoices",
  "/distributor/invoices-in",
  "/customer/distributors",
  "/distributor/providers",
  "/distributor/customers",
  "/provider/distributors",
  "/admin/approvals",
]);

/** True when `pathname` is this tab's route or one of its sub-routes. */
export function isCurrent(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`);
}
