import { LinksPanel, type DirectoryConfig } from "@/components/links-panel";
import { LINKS_PAGE_SIZE } from "@/lib/constants";
import { RoleShell } from "@/components/role-shell";
import type { NavRole } from "@/lib/nav";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import type { LinkKind } from "@/server/db/schema";
import { listLinks } from "@/server/services/links";

/** Server page body for the four link tabs (Providers, Distributors x2, Customers). */
export async function LinkPage({
  role,
  title,
  kind,
  directory,
  emptyText,
}: {
  role: Exclude<NavRole, "ADMIN">;
  title: string;
  kind: LinkKind;
  directory?: DirectoryConfig;
  emptyText: string;
}) {
  const user = await requireRolePage(role);
  const { rows, total } = await listLinks(getDb(), user, { kind, page: 1, limit: LINKS_PAGE_SIZE });
  return (
    <RoleShell role={role} title={title} userName={user.name}>
      <LinksPanel links={rows} total={total} kind={kind} directory={directory} emptyText={emptyText} />
    </RoleShell>
  );
}
