/**
 * Counterparts are shown by business name and city only. Without a business name, a neutral placeholder
 * (never the personal name), unless the caller passes `ownCounterpartName`: a distributor viewing its own
 * customer's link row may fall back to that customer's personal name.
 */
export function partyLabel(businessName: string | null, role: string, id: string, ownCounterpartName?: string | null): string {
  const b = businessName?.trim();
  if (b) return b;
  const n = ownCounterpartName?.trim();
  return n ? n : `Unnamed ${role.toLowerCase()} (#${id.slice(-4)})`;
}
