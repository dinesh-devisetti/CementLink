export const BAGS_PER_TONNE = 20;

const TONNES_RE = /^\d{1,6}(\.\d{1,2})?$/;

/** Convert a tonnes string to whole bags; only multiples of 0.05 t are valid. */
export function tonnesToBags(input: string): number {
  if (typeof input !== "string" || !TONNES_RE.test(input)) {
    throw new Error("Invalid tonnes value");
  }
  const [whole, frac = ""] = input.split(".");
  const hundredths = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  if (hundredths <= 0) throw new Error("Tonnes must be positive");
  // 1 bag = 0.05 t = 5 hundredths
  if (hundredths % 5 !== 0) throw new Error("Tonnes must be a multiple of 0.05");
  return hundredths / 5;
}

export function bagsToTonnes(bags: number): string {
  if (!Number.isInteger(bags) || bags < 0) throw new Error("Bags must be a non-negative integer");
  const hundredths = bags * 5;
  const whole = Math.floor(hundredths / 100);
  const frac = String(hundredths % 100).padStart(2, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : String(whole);
}

export function formatQty(bags: number): string {
  return `${bags} bags (${bagsToTonnes(bags)} t)`;
}

export function tripsFor(bags: number, capacityBags: number): number {
  if (!Number.isInteger(bags) || bags < 0) throw new Error("Invalid bags");
  if (!Number.isInteger(capacityBags) || capacityBags <= 0) throw new Error("Invalid capacity");
  return Math.floor((bags + capacityBags - 1) / capacityBags);
}
