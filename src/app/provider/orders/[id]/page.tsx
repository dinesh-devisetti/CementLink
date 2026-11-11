import Link from "next/link";
import { notFound } from "next/navigation";
import { InvoiceForm } from "@/components/invoice-form";
import { InvoiceList } from "@/components/invoice-list";
import { LogoutButton } from "@/components/logout-button";
import { PoBadge } from "@/components/po-badge";
import { formatPaise } from "@/lib/money";
import { requestIdSchema } from "@/lib/validation/requests";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { getPoForInvoice } from "@/server/services/invoices";

export const dynamic = "force-dynamic";

export default async function ProviderOrderPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireRolePage("PROVIDER");
  const parsed = requestIdSchema.safeParse((await params).id);
  if (!parsed.success) notFound();
  const po = await getPoForInvoice(getDb(), user.id, parsed.data);
  if (!po) notFound();
  return (
    <main className="mx-auto max-w-lg space-y-4 p-4">
      <header className="flex items-center justify-between">
        <span className="font-semibold">CementLink</span>
        <LogoutButton />
      </header>
      <Link href="/provider" className="inline-block min-h-11 py-2 text-sm font-semibold text-primary underline">
        Back to orders
      </Link>
      <h1 className="text-2xl font-semibold">Order from {po.distributorName}</h1>
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm tabular-nums">
          {po.qtyBags} bags · {formatPaise(po.ratePerBagPaise)}/bag · Invoiced {po.invoicedBags} of {po.qtyBags}
        </p>
        <PoBadge status={po.status} />
      </div>
      <h2 className="text-xl font-semibold">Add invoice</h2>
      {po.status !== "CONFIRMED" ? (
        <p className="rounded-card border border-border bg-surface p-4 text-sm">Invoices can only be added to confirmed orders.</p>
      ) : po.remainingBags === 0 ? (
        <p className="rounded-card border border-border bg-surface p-4 text-sm">This order is fully invoiced.</p>
      ) : (
        <InvoiceForm poId={po.id} remainingBags={po.remainingBags} defaultRatePaise={po.ratePerBagPaise} />
      )}
      <h2 className="text-xl font-semibold">Invoices for this order</h2>
      <InvoiceList rows={po.invoices} />
      {po.invoiceCount > po.invoices.length && (
        <p className="text-sm text-muted">
          Showing {po.invoices.length} of {po.invoiceCount}
        </p>
      )}
    </main>
  );
}
