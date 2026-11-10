import type { PoStatus } from "@/server/db/schema";
import { cn } from "./ui";

const STYLE: Record<PoStatus, string> = {
  PLACED: "border-info text-info",
  CONFIRMED: "border-success text-success",
  REJECTED: "border-danger text-danger",
};
const LABEL: Record<PoStatus, string> = { PLACED: "Placed", CONFIRMED: "Confirmed", REJECTED: "Rejected" };

export function PoBadge({ status }: { status: PoStatus }) {
  return <span className={cn("inline-block rounded-input border px-2 py-0.5 text-xs font-semibold", STYLE[status])}>{LABEL[status]}</span>;
}
