/** Pure helpers for the split-allocation form. Allocations are raw input strings keyed by distributor id. */
export type Allocations = Record<string, string>;

function bagsOf(raw: string): number {
  return /^\d{1,7}$/.test(raw) ? Number(raw) : 0;
}

export function allocatedBags(a: Allocations): number {
  return Object.values(a).reduce((s, v) => s + bagsOf(v), 0);
}

export function remainingBags(total: number | null, a: Allocations): number | null {
  return total === null ? null : total - allocatedBags(a);
}

export function splitEvenly(total: number, ids: readonly string[]): Allocations {
  if (ids.length === 0) return {};
  const base = Math.floor(total / ids.length);
  const extra = total % ids.length;
  return Object.fromEntries(ids.map((id, i) => [id, String(base + (i < extra ? 1 : 0))]));
}

/** Reason text shown above the submit button; null means the form may be submitted. */
export function submitBlocker(total: number | null, a: Allocations): string | null {
  if (total === null) return "Enter a valid quantity";
  const ids = Object.keys(a);
  if (ids.length === 0) return "Pick at least one distributor";
  if (ids.some((id) => bagsOf(a[id]) < 1)) return "Each distributor needs at least 1 bag";
  const rem = total - allocatedBags(a);
  if (rem > 0) return `${rem} bags left to allocate`;
  if (rem < 0) return `${-rem} bags over-allocated`;
  return null;
}

const FORM_FIELDS = new Set(["quantity", "address", "city", "pincode", "neededBy", "allocations"]);

/** Maps server validation `fields` onto form inputs; anything with no input becomes a general message. */
export function mapServerFields(raw: Record<string, string>): { fields: Record<string, string>; general: string | null } {
  const fields: Record<string, string> = {};
  const general: string[] = [];
  for (const [key, msg] of Object.entries(raw)) {
    const top = key.split(".")[0];
    if (FORM_FIELDS.has(top)) fields[top] ??= msg;
    else general.push(msg);
  }
  return { fields, general: general.length ? general.join(". ") : null };
}
