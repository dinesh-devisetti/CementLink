import { describe, expect, it } from "vitest";
import { BUILT_HREFS, isCurrent, ROLE_NAV } from "@/lib/nav";

describe("role nav", () => {
  it("has every 02-design.md tab for every role, under the role's own prefix", () => {
    const hrefs = (r: keyof typeof ROLE_NAV) => ROLE_NAV[r].map((i) => i.href);
    expect(hrefs("CUSTOMER")).toEqual(["/customer/orders", "/customer/distributors", "/customer/invoices", "/customer/payments"]);
    expect(hrefs("DISTRIBUTOR")).toEqual([
      "/distributor/orders", "/distributor/providers", "/distributor/customers", "/distributor/pos",
      "/distributor/invoices-in", "/distributor/invoices-out", "/distributor/payments",
    ]);
    expect(hrefs("PROVIDER")).toEqual(["/provider/orders", "/provider/distributors", "/provider/invoices", "/provider/payments"]);
    expect(hrefs("ADMIN")).toEqual(["/admin/approvals", "/admin/distributors", "/admin/customers", "/admin/transport"]);
    for (const [role, items] of Object.entries(ROLE_NAV)) {
      for (const i of items) expect(i.href.startsWith(`/${role.toLowerCase()}/`)).toBe(true);
    }
  });

  it("built tabs are all real nav entries", () => {
    const all = new Set(Object.values(ROLE_NAV).flatMap((l) => l.map((i) => i.href)));
    for (const h of BUILT_HREFS) expect(all.has(h)).toBe(true);
  });

  it("isCurrent matches the route and sub-routes only", () => {
    expect(isCurrent("/customer/orders", "/customer/orders")).toBe(true);
    expect(isCurrent("/customer/orders/new", "/customer/orders")).toBe(true);
    expect(isCurrent("/customer/orders-old", "/customer/orders")).toBe(false);
    expect(isCurrent("/customer", "/customer/orders")).toBe(false);
  });
});
