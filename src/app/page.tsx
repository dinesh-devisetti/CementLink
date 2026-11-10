import { redirect } from "next/navigation";
import { DASHBOARD_PATH } from "@/lib/roles";
import { getActor } from "@/server/auth/guards";

export const dynamic = "force-dynamic";

export default async function Home() {
  const actor = await getActor();
  if (!actor) redirect("/login");
  redirect(actor.status === "ACTIVE" ? DASHBOARD_PATH[actor.role] : "/pending");
}
