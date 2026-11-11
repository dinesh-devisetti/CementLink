import Link from "next/link";
import { InvoiceList } from "@/components/invoice-list";
import { LogoutButton } from "@/components/logout-button";
import { ProviderOrders } from "@/components/provider-orders";
import { cn } from "@/components/ui";
import { formatPaise } from "@/lib/money";
import { requireRolePage } from "@/server/auth/guards";
import { getDb } from "@/server/db/client";
import { listInvoices, providerInvoiceTotals, providerTotalsByDistributor } from "@/server/services/invoices";
import { listPos, providerSummary } from "@/server/services/pos";

export const dynamic = "force-dynamic";

const TABS = [
  { id: "orders", label: "Orders" },
  { id: "invoices", label: "Invoices" },
  { id: "distributors", label: "By distributor" },
] as const;
type Tab = (typeof TABS)[number]["id"];

function Kpi({ label, value, testId }: { label: string; value: string | number; testId?: string }) {
  return (
    <div className="rounded-card border border-border bg-surface p-4">
      <p className="text-sm text-muted">{label}</p>
      <p className="font-semibold tabular-nums" data-testid={testId}>
        {value}
      </p>
    </div>
  );
}

export default async function ProviderDashboard({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await requireRolePage("PROVIDER");
  const raw = (await searchParams).tab;
  const tab: Tab = TABS.some((t) => t.id === raw) ? (raw as Tab) : "orders";
  const db = getDb();
  const actor = { id: user.id, role: "PROVIDER" } as const;
  const page = { page: 1, limit: 50 };
  const [summary, totals] = await Promise.all([providerSummary(db, user.id), providerInvoiceTotals(db, user.id)]);
  const orders = tab === "orders" ? await listPos(db, actor, page) : null;
  const invs = tab === "invoices" ? await listInvoices(db, actor, page) : null;
  const byDist = tab === "distributors" ? await providerTotalsByDistributor(db, user.id) : null;
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4">
      <header className="flex items-center justify-between">
        <span className="font-semibold">CementLink</span>
        <LogoutButton />
      </header>
      <h1 className="text-2xl font-semibold">Provider dashboard</h1>
      <p className="text-muted">Hello, {user.name}</p>
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-label="Summary">
        <Kpi label="Orders received" value={summary.ordersReceived} testId="orders-received" />
        <Kpi label="Awaiting reply" value={summary.awaitingReply} />
        <Kpi label="Bags to supply" value={summary.bagsToSupply} testId="bags-to-supply" />
        <Kpi label="Bags sold" value={totals.bagsSold} testId="bags-sold" />
        <Kpi label="Invoiced" value={formatPaise(totals.invoicedPaise)} testId="invoiced-total" />
      </section>
      <nav aria-label="Dashboard sections" className="flex gap-2">
        {TABS.map((t) => (
          <Link
            key={t.id}
            href={t.id === "orders" ? "/provider" : `/provider?tab=${t.id}`}
            aria-current={t.id === tab ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 items-center rounded-input border border-border px-3 text-sm font-semibold",
              t.id === tab && "bg-primary text-primary-fg",
            )}
          >
            {t.label}
          </Link>
        ))}
      </nav>
      {orders && (
        <>
          <h2 className="text-xl font-semibold">Orders received</h2>
          <ProviderOrders rows={orders.rows} />
          {orders.total > orders.rows.length && <p className="text-sm text-muted">Showing {orders.rows.length} of {orders.total}</p>}
        </>
      )}
      {invs && (
        <>
          <h2 className="text-xl font-semibold">Invoices</h2>
          <InvoiceList rows={invs.rows} />
          {invs.total > invs.rows.length && <p className="text-sm text-muted">Showing {invs.rows.length} of {invs.total}</p>}
        </>
      )}
      {byDist && (
        <>
          <h2 className="text-xl font-semibold">By distributor</h2>
          {byDist.length === 0 ? (
            <p className="rounded-card border border-border bg-surface p-4 text-sm">No invoices yet</p>
          ) : (
            <ul className="space-y-2">
              {byDist.map((d) => (
                <li key={d.distributorId} className="rounded-input border border-border bg-surface p-3 text-sm" data-testid="dist-total">
                  <p className="font-semibold">{d.name}</p>
                  <p className="tabular-nums">
                    {d.bagsSold} bags · {formatPaise(d.invoicedPaise)} · {d.invoiceCount} invoice{d.invoiceCount === 1 ? "" : "s"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </main>
  );
}
