import { redirect } from "next/navigation";
import { LoginForm } from "@/components/login-form";
import { DASHBOARD_PATH } from "@/lib/roles";
import { getActor } from "@/server/auth/guards";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const actor = await getActor();
  if (actor) redirect(actor.status === "ACTIVE" ? DASHBOARD_PATH[actor.role] : "/pending");
  return <LoginForm />;
}
