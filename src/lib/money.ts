const RUPEES_RE = /^\d{1,7}(\.\d{1,2})?$/;

/** Parse a rupee string such as "385.50" into integer paise. No floats involved. */
export function parseRupeesToPaise(input: string): number {
  if (typeof input !== "string" || !RUPEES_RE.test(input)) {
    throw new Error("Invalid rupee amount");
  }
  const [whole, frac = ""] = input.split(".");
  return Number(whole) * 100 + Number(frac.padEnd(2, "0"));
}

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR" });

export function formatPaise(paise: number): string {
  if (!Number.isInteger(paise)) throw new Error("Paise must be an integer");
  return inr.format(paise / 100);
}
