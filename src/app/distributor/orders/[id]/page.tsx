import { notFound } from "next/navigation";
import { DistributorOrderView } from "@/components/distributor-order-view";
import { RoleShell } from "@/components/role-shell";
import { todayIst } from "@/lib/dates";
import { orderIdSchema } from "@/lib/validation/orders";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { getOrder } from "@/server/services/orders";
import { listLinkedProviders, listPos } from "@/server/services/pos";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRolePage("DISTRIBUTOR");
  const id = orderIdSchema.safeParse((await params).id);
  if (!id.success) notFound();
  const db = getDb();
  try {
    const order = await getOrder(db, user, id.data);
    const [drafts, providers] = await Promise.all([
      order.status === "UNDER_REVIEW" ? listPos(db, user, { status: "DRAFT", orderId: id.data, page: 1, limit: 50 }) : { rows: [] },
      listLinkedProviders(db, user.id),
    ]);
    return (
      <RoleShell role="DISTRIBUTOR" title="Order" back={{ href: "/distributor/orders", label: "Orders" }} userName={user.name}>
        <DistributorOrderView order={order} drafts={drafts.rows} providers={providers} deliveredOn={order.deliveredOn ?? undefined} today={todayIst()} />
      </RoleShell>
    );
  } catch (e) {
    if (e instanceof AppError && e.httpStatus === 404) notFound();
    throw e;
  }
}
