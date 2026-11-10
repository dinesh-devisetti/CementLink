import Link from "next/link";
import { notFound } from "next/navigation";
import { RequestCard } from "@/components/request-card";
import { requestIdSchema } from "@/lib/validation/requests";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { getRequest } from "@/server/services/requests";

export const dynamic = "force-dynamic";

export default async function RequestDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRolePage("CUSTOMER");
  const parsed = requestIdSchema.safeParse((await params).id);
  if (!parsed.success) notFound();
  const request = await getRequest(getDb(), user.id, parsed.data);
  if (!request) notFound();
  return (
    <main className="mx-auto max-w-lg space-y-4 p-4">
      <Link href="/customer" className="inline-block min-h-11 py-2 text-sm font-semibold text-primary underline">
        Back to requests
      </Link>
      <h1 className="text-2xl font-semibold">Request details</h1>
      <RequestCard request={request} link={false} />
      <p className="text-sm text-muted">Payments will appear here once a distributor accepts.</p>
    </main>
  );
}
