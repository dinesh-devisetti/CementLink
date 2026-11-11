import { tonnesToKg } from "./qty";

export interface SplitRowInput {
  providerId: string;
  tonnes: string;
}

export interface SplitSummary {
  /** Order total in kg, or null while the total input is invalid. */
  totalKg: number | null;
  /** Sum of the valid allocation rows, kg. */
  allocatedKg: number;
  /** total - allocated (never negative); what goes to "distributor's choice". Null while the total is invalid. */
  remainderKg: number | null;
  over: boolean;
  /** Row index to message. */
  rowErrors: Record<number, string>;
  /** True when the form may be submitted (total valid, every row valid, not over-allocated). */
  ok: boolean;
}

/** Live split maths for the order form: provider allocations plus the remainder left to the distributor. */
export function summarizeSplit(totalInput: string, rows: readonly SplitRowInput[]): SplitSummary {
  let totalKg: number | null = null;
  try {
    totalKg = tonnesToKg(totalInput);
  } catch {
    totalKg = null;
  }
  const rowErrors: Record<number, string> = {};
  const seen = new Set<string>();
  let allocatedKg = 0;
  rows.forEach((r, i) => {
    if (!r.providerId) rowErrors[i] = "Choose a provider";
    else if (seen.has(r.providerId)) rowErrors[i] = "Each provider can appear only once";
    seen.add(r.providerId);
    try {
      const kg = tonnesToKg(r.tonnes);
      allocatedKg += kg;
    } catch {
      rowErrors[i] ??= "Enter tonnes with up to 3 decimals";
    }
  });
  const over = totalKg !== null && allocatedKg > totalKg;
  return {
    totalKg,
    allocatedKg,
    remainderKg: totalKg === null ? null : Math.max(0, totalKg - allocatedKg),
    over,
    rowErrors,
    ok: totalKg !== null && !over && Object.keys(rowErrors).length === 0,
  };
}
