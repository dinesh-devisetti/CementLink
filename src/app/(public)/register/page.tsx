import { redirect } from "next/navigation";
import { RegisterForm } from "@/components/register-form";
import { DASHBOARD_PATH } from "@/lib/roles";
import { getActor } from "@/server/auth/guards";

export const dynamic = "force-dynamic";

export default async function RegisterPage() {
  const actor = await getActor();
  if (actor) redirect(actor.status === "ACTIVE" ? DASHBOARD_PATH[actor.role] : "/pending");
  return <RegisterForm />;
}
