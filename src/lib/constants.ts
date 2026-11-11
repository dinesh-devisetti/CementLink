// Edge-safe constants (importable from middleware and client code).
export const SESSION_COOKIE = "cl_session";
export const MAX_PRICE_PAISE = 10_000_000; // Rs 1,00,000 per bag is far above any real price
export const ROLE_VALUES = ["CUSTOMER", "DISTRIBUTOR", "PROVIDER", "ADMIN"] as const;
