import type { PoView } from "@/server/services/pos";

/** Dispatch date, vehicle and (only when the viewer may see it) driver phone. */
export function TransportDetails({ dispatch }: { dispatch: PoView["dispatch"] }) {
  if (!dispatch) return null;
  return (
    <section aria-label="Transport" className="space-y-1 rounded-card border border-border bg-surface p-4">
      <h2 className="text-xl font-semibold">Transport</h2>
      <p className="text-sm">Dispatched on {dispatch.dispatchDate}</p>
      {dispatch.vehicleNo && <p className="text-sm">Vehicle {dispatch.vehicleNo}</p>}
      {dispatch.driverPhone && <p className="text-sm">Driver {dispatch.driverPhone}</p>}
    </section>
  );
}
