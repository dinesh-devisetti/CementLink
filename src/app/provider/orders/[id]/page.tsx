import { notFound } from "next/navigation";
import { ProviderPoView } from "@/components/provider-po-view";
import { RoleShell } from "@/components/role-shell";
import { poIdSchema } from "@/lib/validation/drafts";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { getPo } from "@/server/services/pos";
import { getPoInvoicing } from "@/server/services/provider-invoices";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRolePage("PROVIDER");
  const id = poIdSchema.safeParse((await params).id);
  if (!id.success) notFound();
  try {
    const db = getDb();
    const po = await getPo(db, user, id.data);
    const invoicing = await getPoInvoicing(db, user, id.data);
    return (
      <RoleShell role="PROVIDER" title="Purchase order" back={{ href: "/provider/orders", label: "Purchase orders" }} userName={user.name}>
        <ProviderPoView po={po} invoicing={invoicing} />
      </RoleShell>
    );
  } catch (e) {
    if (e instanceof AppError && e.httpStatus === 404) notFound();
    throw e;
  }
}
