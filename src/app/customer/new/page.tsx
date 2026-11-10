import Link from "next/link";
import { NewRequestForm } from "@/components/new-request-form";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { listActiveDistributors } from "@/server/services/requests";

export const dynamic = "force-dynamic";

export default async function NewRequestPage() {
  await requireRolePage("CUSTOMER");
  const distributors = await listActiveDistributors(getDb());
  return (
    <main className="mx-auto max-w-lg space-y-4 p-4">
      <Link href="/customer" className="inline-block min-h-11 py-2 text-sm font-semibold text-primary underline">
        Back to requests
      </Link>
      <h1 className="text-2xl font-semibold">New request</h1>
      <NewRequestForm distributors={distributors} />
    </main>
  );
}
