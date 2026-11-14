import { notFound } from "next/navigation";
import { DistributorPoView } from "@/components/distributor-po-view";
import { RoleShell } from "@/components/role-shell";
import { poIdSchema } from "@/lib/validation/drafts";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { getPo } from "@/server/services/pos";

export const dynamic = "force-dynamic";

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ from?: string }> }) {
  const user = await requireRolePage("DISTRIBUTOR");
  const from = (await searchParams).from === "all" ? "all" : "placed";
  const id = poIdSchema.safeParse((await params).id);
  if (!id.success) notFound();
  try {
    const po = await getPo(getDb(), user, id.data);
    return (
      <RoleShell role="DISTRIBUTOR" title="Purchase order" back={{ href: `/distributor/pos?tab=${from}`, label: from === "all" ? "All POs" : "Placed POs" }} userName={user.name}>
        <DistributorPoView po={po} />
      </RoleShell>
    );
  } catch (e) {
    if (e instanceof AppError && e.httpStatus === 404) notFound();
    throw e;
  }
}
