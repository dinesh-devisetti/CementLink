import { notFound } from "next/navigation";
import { ProviderPoView } from "@/components/provider-po-view";
import { RoleShell } from "@/components/role-shell";
import { poIdSchema } from "@/lib/validation/drafts";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { getPo } from "@/server/services/pos";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRolePage("PROVIDER");
  const id = poIdSchema.safeParse((await params).id);
  if (!id.success) notFound();
  try {
    const po = await getPo(getDb(), user, id.data);
    return (
      <RoleShell role="PROVIDER" title="Purchase order" userName={user.name}>
        <ProviderPoView po={po} />
      </RoleShell>
    );
  } catch (e) {
    if (e instanceof AppError && e.httpStatus === 404) notFound();
    throw e;
  }
}
