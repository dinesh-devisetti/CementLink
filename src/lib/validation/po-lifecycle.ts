import { z } from "zod";
import { rejectOrderSchema } from "./drafts";

/** Provider reject: the same bounded, control-character-free reason as an order reject. */
export const rejectPoSchema = rejectOrderSchema;
export type RejectPoInput = z.infer<typeof rejectPoSchema>;

const isRealDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const t = new Date(`${s}T00:00:00Z`).getTime();
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === s;
};

/** Blank means absent. */
const blankToNull = (v: unknown) => (typeof v === "string" && v.trim() === "" ? null : v);

const vehicleNo = z.preprocess(
  (v) => (typeof v === "string" ? blankToNull(v.toUpperCase().replace(/[\s-]/g, "")) : v),
  z.string().regex(/^[A-Z0-9]{4,12}$/, "Vehicle number must be 4 to 12 letters or digits").nullable().default(null),
);
const driverPhone = z.preprocess(
  (v) => (typeof v === "string" ? blankToNull(v.trim()) : v),
  z.string().regex(/^[6-9]\d{9}$/, "Enter a 10-digit mobile number").nullable().default(null),
);

/** POST /pos/:id/dispatch. The date window (placed date <= date <= today) is checked by the service. */
export const dispatchSchema = z
  .object({
    dispatchDate: z.string().refine(isRealDate, "Enter a valid date"),
    vehicleNo,
    driverPhone,
  })
  .strict();
export type DispatchInput = z.infer<typeof dispatchSchema>;
