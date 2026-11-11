import { MAX_ORDER_KG, MAX_RATE_PER_TONNE_PAISE } from "../../lib/constants";

/**
 * amount_paise = (qty_kg * rate_per_tonne_paise + 500) / 1000, integer division (round half up).
 * Mirrors the SQL CHECK on every amount column. Max product 1e13 is safe in int64 and JS integers.
 */
export function amountPaise(qtyKg: number, ratePerTonnePaise: number): number {
  if (!Number.isInteger(qtyKg) || qtyKg <= 0 || qtyKg > MAX_ORDER_KG) throw new Error("Invalid qty_kg");
  if (!Number.isInteger(ratePerTonnePaise) || ratePerTonnePaise <= 0 || ratePerTonnePaise > MAX_RATE_PER_TONNE_PAISE) {
    throw new Error("Invalid rate");
  }
  return Math.floor((qtyKg * ratePerTonnePaise + 500) / 1000);
}
