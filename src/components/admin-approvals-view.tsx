import { ApprovalsList } from "@/components/approvals-list";
import { ApprovedList } from "@/components/approved-list";
import { ForceLinkForm } from "@/components/force-link-form";
import { RoleShell } from "@/components/role-shell";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { listLinkableParties, listUsersByStatus } from "@/server/services/admin-users";

/** Admin Approvals tab: pending approvals, approved list with Revoke, force-link form. Shared by /admin and /admin/approvals. */
export async function AdminApprovalsView({ title }: { title: string }) {
  const user = await requireRolePage("ADMIN");
  const db = getDb();
  const [{ rows: pending, total }, { rows: approved, total: approvedTotal }, parties] = await Promise.all([
    listUsersByStatus(db, "PENDING"),
    listUsersByStatus(db, "ACTIVE"),
    listLinkableParties(db),
  ]);
  return (
    <RoleShell role="ADMIN" title={title} userName={user.name}>
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
      <section aria-labelledby="approved-h" className="space-y-3">
        <h2 id="approved-h" className="text-xl font-semibold">
          Approved accounts ({approvedTotal})
        </h2>
        <ApprovedList rows={approved} />
        {approvedTotal > approved.length && (
          <p className="text-sm text-muted">
            Showing {approved.length} of {approvedTotal}.
          </p>
        )}
      </section>
      <section aria-labelledby="link-h" className="space-y-3">
        <h2 id="link-h" className="text-xl font-semibold">
          Link parties
        </h2>
        <ForceLinkForm parties={parties} />
      </section>
    </RoleShell>
  );
}
