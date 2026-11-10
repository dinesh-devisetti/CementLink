export type RoleName = "CUSTOMER" | "DISTRIBUTOR" | "PROVIDER" | "ADMIN";

export const DASHBOARD_PATH: Record<RoleName, string> = {
  CUSTOMER: "/customer",
  DISTRIBUTOR: "/distributor",
  PROVIDER: "/provider",
  ADMIN: "/admin",
};

