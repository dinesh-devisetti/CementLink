import { MAX_ORDER_KG } from "./constants";

export { MAX_ORDER_KG };

/** Tonnes input: 1-4 integer digits, optional 1-3 decimals. No sign, exponent, comma or whitespace. */
const TONNES_RE = /^\d{1,4}(\.\d{1,3})?$/;
export const INVALID_TONNES = "Enter tonnes with up to 3 decimals (max 1000)";

/** Convert a tonnes string to integer kg. Throws Error(INVALID_TONNES) unless 0 < kg <= MAX_ORDER_KG. */
export function tonnesToKg(input: string): number {
  if (typeof input !== "string" || !TONNES_RE.test(input)) throw new Error(INVALID_TONNES);
  const [whole, frac = ""] = input.split(".");
  const kg = Number(whole) * 1000 + Number(frac.padEnd(3, "0"));
  if (kg <= 0 || kg > MAX_ORDER_KG) throw new Error(INVALID_TONNES);
  return kg;
}

/** Integer kg to a tonnes string with trailing zeros trimmed: 10500 -> "10.5". */
export function kgToTonnes(kg: number): string {
  if (!Number.isInteger(kg) || kg < 0) throw new Error("Kg must be a non-negative integer");
  const whole = Math.floor(kg / 1000);
  const frac = String(kg % 1000).padStart(3, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

export function formatTonnes(kg: number): string {
  return `${kgToTonnes(kg)} t`;
}
