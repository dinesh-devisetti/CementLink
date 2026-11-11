// Edge-safe constants (importable from middleware and client code).
export const SESSION_COOKIE = "cl_session";
export const MAX_RATE_PER_TONNE_PAISE = 10_000_000; // Rs 1,00,000 per tonne is far above any real rate
export const MAX_ORDER_KG = 1_000_000; // 1000 tonnes
export const ROLE_VALUES = ["CUSTOMER", "DISTRIBUTOR", "PROVIDER", "ADMIN"] as const;
export const LINKS_PAGE_SIZE = 50; // links per page on the link tabs (server page 1 + "Load more")
