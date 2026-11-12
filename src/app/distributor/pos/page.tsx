import Link from "next/link";
import { DraftPanel } from "@/components/draft-panel";
import { PoList } from "@/components/po-list";
import { RoleShell } from "@/components/role-shell";
import { cn } from "@/components/ui";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { listLinkedProviders, listPos } from "@/server/services/pos";

export const dynamic = "force-dynamic";

const TABS = [
  { key: "drafts", label: "Drafts" },
  { key: "placed", label: "Placed" },
  { key: "all", label: "All" },
] as const;

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireRolePage("DISTRIBUTOR");
  const requested = (await searchParams).tab;
  const tab = TABS.find((t) => t.key === requested)?.key ?? "drafts";
  const db = getDb();
  const providers = await listLinkedProviders(db, user.id);
  const all = await listPos(db, user, { status: tab === "drafts" ? "DRAFT" : undefined, excludeDraft: tab === "placed", page: 1, limit: 50 });
  const rows = all.rows;
  return (
    <RoleShell role="DISTRIBUTOR" title="Purchase orders" userName={user.name}>
      <nav aria-label="Purchase order tabs" className="flex gap-2">
        {TABS.map((t) => (
          <Link
            key={t.key}
            href={`/distributor/pos?tab=${t.key}`}
            aria-current={t.key === tab ? "page" : undefined}
            className={cn("rounded-input border border-border px-3 py-2 text-sm font-semibold", t.key === tab && "bg-primary text-primary-fg")}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {tab === "drafts" ? <DraftPanel drafts={rows} providers={providers} /> : <PoList pos={rows} total={all.total} role="DISTRIBUTOR" />}
    </RoleShell>
  );
}
