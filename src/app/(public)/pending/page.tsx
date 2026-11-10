import { redirect } from "next/navigation";
import { Clock } from "lucide-react";
import { LogoutButton } from "@/components/logout-button";
import { Card } from "@/components/ui";
import { DASHBOARD_PATH } from "@/lib/roles";
import { getActor } from "@/server/auth/guards";

export const dynamic = "force-dynamic";

// Access gate: PENDING and REJECTED users land here and see no actions.
export default async function PendingPage() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  if (actor.status === "ACTIVE") redirect(DASHBOARD_PATH[actor.role]);
  const rejected = actor.status === "REJECTED";
  return (
    <Card className="w-full max-w-sm space-y-4 text-center">
      <Clock className="mx-auto" aria-hidden />
      <h1 className="text-xl font-semibold">{rejected ? "Your account was not approved" : "Waiting for admin approval"}</h1>
      <LogoutButton />
    </Card>
  );
}
