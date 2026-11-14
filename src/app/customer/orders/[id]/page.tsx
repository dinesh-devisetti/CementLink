import { notFound } from "next/navigation";
import { OrderDetailView } from "@/components/order-detail";
import { RoleShell } from "@/components/role-shell";
import { orderIdSchema } from "@/lib/validation/orders";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { getOrder } from "@/server/services/orders";

export const dynamic = "force-dynamic";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRolePage("CUSTOMER");
  const id = orderIdSchema.safeParse((await params).id);
  if (!id.success) notFound();
  try {
    const order = await getOrder(getDb(), user, id.data);
    return (
      <RoleShell role="CUSTOMER" title="Order" back={{ href: "/customer/orders", label: "My orders" }} userName={user.name}>
        <OrderDetailView order={order} />
      </RoleShell>
    );
  } catch (e) {
    if (e instanceof AppError && e.httpStatus === 404) notFound();
    throw e;
  }
}
