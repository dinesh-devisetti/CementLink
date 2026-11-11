import { ApprovalsList } from "@/components/approvals-list";
import { RoleShell } from "@/components/role-shell";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { listUsersByStatus } from "@/server/services/admin-users";

export const dynamic = "force-dynamic";

export default async function AdminDashboard() {
  const user = await requireRolePage("ADMIN");
  const { rows: pending, total } = await listUsersByStatus(getDb(), "PENDING");
  return (
    <RoleShell role="ADMIN" title="Admin dashboard" userName={user.name} live={["Approvals"]}>
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
    </RoleShell>
  );
}
