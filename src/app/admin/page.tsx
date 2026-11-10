import { ApprovalsList } from "@/components/approvals-list";
import { LogoutButton } from "@/components/logout-button";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { listUsersByStatus } from "@/server/services/admin-users";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const user = await requireRolePage("ADMIN");
  const { rows: pending, total } = await listUsersByStatus(getDb(), "PENDING");
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4">
      <header className="flex items-center justify-between">
        <span className="font-semibold">CementLink</span>
        <LogoutButton />
      </header>
      <h1 className="text-2xl font-semibold">Admin dashboard</h1>
      <p className="text-muted">Hello, {user.name}</p>
      <section aria-labelledby="approvals-h" className="space-y-3">
        <h2 id="approvals-h" className="text-xl font-semibold">
          Approvals ({total})
        </h2>
        <ApprovalsList rows={pending} />
        {total > pending.length && (
          <p className="text-sm text-muted">
            Showing {pending.length} of {total}. Approve or reject to see the rest.
          </p>
        )}
      </section>
    </main>
  );
}
