/**
 * Concurrency check for the money invariants: qty cap, overpay, duplicate capture.
 *
 *   npx tsx scripts/concurrency-check.ts
 *
 * Default: a throwaway local libSQL file in the OS temp dir (deleted afterwards).
 * Remote: only when YOU pass CONCURRENCY_DATABASE_URL (+ CONCURRENCY_DATABASE_AUTH_TOKEN) AND CONCURRENCY_CONFIRM_REMOTE=yes.
 * It then migrates and writes clearly named test rows into THAT database. It never creates cloud resources and never reads .env files.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

const ROUNDS = Number(process.env.CONCURRENCY_ROUNDS ?? 5);
if (!Number.isInteger(ROUNDS) || ROUNDS < 1) {
  console.error("CONCURRENCY_ROUNDS must be an integer >= 1");
  process.exit(1);
}
const originalDatabaseUrl = process.env.DATABASE_URL;
const remoteUrl = process.env.CONCURRENCY_DATABASE_URL;
if (remoteUrl && process.env.CONCURRENCY_CONFIRM_REMOTE !== "yes") {
  console.error("CONCURRENCY_DATABASE_URL is set: also set CONCURRENCY_CONFIRM_REMOTE=yes to write test rows there.");
  process.exit(1);
}
if (remoteUrl && remoteUrl === originalDatabaseUrl) {
  console.error("Refusing: CONCURRENCY_DATABASE_URL equals DATABASE_URL (the app database). Use a dedicated test database.");
  process.exit(1);
}
if (remoteUrl) {
  let host = remoteUrl;
  try { host = new URL(remoteUrl).host || remoteUrl; } catch { /* keep raw */ }
  console.log(`Remote mode: writing test rows to ${host}`);
}
const dir = remoteUrl ? null : mkdtempSync(path.join(tmpdir(), "cl-conc-"));
const url = remoteUrl ?? `file:${path.join(dir as string, "conc.db")}`;
process.env.DATABASE_URL = url;
process.env.DATABASE_AUTH_TOKEN = process.env.CONCURRENCY_DATABASE_AUTH_TOKEN ?? "";
process.env.APP_URL ??= "http://localhost:3000";
process.env.PAYMENT_GATEWAY = "fake";
process.env.E2E = "1";
delete process.env.VERCEL;
delete process.env.RAZORPAY_WEBHOOK_SECRET;

const failures: string[] = [];
const check = (name: string, ok: boolean, detail = "") => {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures.push(name);
};

async function main() {
  const { sql, eq } = await import("drizzle-orm");
  const { migrate } = await import("drizzle-orm/libsql/migrator");
  const { createDb } = await import("../src/server/db/client");
  const schema = await import("../src/server/db/schema");
  const { registerUser } = await import("../src/server/services/users");
  const { createProviderInvoice } = await import("../src/server/services/provider-invoices");
  const { createProviderPayment } = await import("../src/server/services/provider-payments");
  const { createCustomerInvoice, requestPayment } = await import("../src/server/services/customer-invoices");
  const { createPaymentOrder } = await import("../src/server/services/payments");
  const { handleRazorpayWebhook } = await import("../src/server/services/webhooks");
  const { hmacHex, FAKE_WEBHOOK_SECRET } = await import("../src/server/payments/signature");

  const db = createDb(url, process.env.CONCURRENCY_DATABASE_AUTH_TOKEN);
  // Each racer gets its own client/connection so the races truly interleave.
  const racer = () => createDb(url, process.env.CONCURRENCY_DATABASE_AUTH_TOKEN);
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, "../drizzle") });

  const run = randomBytes(4).toString("hex");
  const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  let seq = 0;
  const uid = () => `conc-${run}-${++seq}`;
  const mk = async (role: "CUSTOMER" | "DISTRIBUTOR" | "PROVIDER", name: string) => {
    const u = await registerUser(db, { name, email: `${uid()}@conc.invalid`, password: randomBytes(9).toString("hex"), role, phone: "9876543210", businessName: `${name} Conc`, city: "Pune" } as never);
    await db.update(schema.users).set({ status: "ACTIVE" }).where(eq(schema.users.id, u.id));
    return (await db.select().from(schema.users).where(eq(schema.users.id, u.id)))[0];
  };
  const giri = await mk("DISTRIBUTOR", "Giri");
  const anjani = await mk("PROVIDER", "Anjani");
  const ramu = await mk("CUSTOMER", "Ramu");

  const mkOrder = async (status: string, qtyKg: number) => {
    const id = uid();
    const now = Date.now();
    await db.run(sql`INSERT INTO orders (id, customer_id, distributor_id, qty_kg, address, city, pincode, needed_by, status, delivered_at, created_at, updated_at)
      VALUES (${id}, ${ramu.id}, ${giri.id}, ${qtyKg}, 'Addr', 'Pune', '411001', ${today}, ${status}, ${now}, ${now}, ${now})`);
    return id;
  };
  const mkDispatchedPo = async (qtyKg: number) => {
    const id = uid();
    const now = Date.now();
    await db.run(sql`INSERT INTO purchase_orders (id, distributor_id, provider_id, status, version, qty_kg, rate_per_tonne_paise, total_paise, placed_at, created_at, updated_at)
      VALUES (${id}, ${giri.id}, ${anjani.id}, 'DISPATCHED', 1, ${qtyKg}, 500000, ${Math.floor((qtyKg * 500000 + 500) / 1000)}, ${now}, ${now}, ${now})`);
    return id;
  };
  const settled = async <T>(fns: Array<() => Promise<T>>) => Promise.allSettled(fns.map((f) => f()));
  const n = async (q: ReturnType<typeof sql>) => Number((await db.all<{ v: number | null }>(q))[0].v ?? 0);

  for (let round = 1; round <= ROUNDS; round++) {
    // 1. Qty cap: 5 x 4 t racing on a 10 t PO -> exactly 2 win, SUM = 8000 kg.
    const poId = await mkDispatchedPo(10_000);
    const inv = await settled([1, 2, 3, 4, 5].map((i) => () => createProviderInvoice(racer(), anjani, poId, { invoiceNo: `C${run}${round}${i}`.toUpperCase(), invoiceDate: today, qtyKg: 4000, ratePerTonnePaise: 500000 })));
    const sumKg = await n(sql`SELECT SUM(qty_kg) AS v FROM provider_invoices WHERE po_id = ${poId}`);
    check(`r${round} qty-cap: exactly 2 winners, sum <= PO qty`, inv.filter((r) => r.status === "fulfilled").length === 2 && sumKg === 8000, `winners=${inv.filter((r) => r.status === "fulfilled").length} sumKg=${sumKg}`);

    // 2. Overpay: invoice 20,000.00 (4 t x 5000); 4 x 10,000.00 racing -> exactly 2 win, paid = amount.
    const poPay = await mkDispatchedPo(4000);
    const { id: invId, amountPaise } = await createProviderInvoice(db, anjani, poPay, { invoiceNo: `P${run}${round}`.toUpperCase(), invoiceDate: today, qtyKg: 4000, ratePerTonnePaise: 500000 });
    const pays = await settled([1, 2, 3, 4].map(() => () => createProviderPayment(racer(), giri, invId, { amountPaise: amountPaise / 2, paidOn: today, mode: "UPI", reference: null })));
    const paid = await n(sql`SELECT SUM(amount_paise) AS v FROM provider_payments WHERE provider_invoice_id = ${invId}`);
    check(`r${round} overpay: paid never exceeds invoice`, paid <= amountPaise && pays.filter((r) => r.status === "fulfilled").length === 2, `paid=${paid}/${amountPaise}`);

    // 3. Duplicate capture: two CREATED attempts for one invoice, both captured at once -> one PAID, one duplicate_payment.
    const orderId = await mkOrder("DELIVERED", 10_000);
    const ci = await createCustomerInvoice(db, giri, orderId, { invoiceNo: `D${run}${round}`.toUpperCase(), invoiceDate: today, ratePerTonnePaise: 650000 });
    await requestPayment(db, giri, ci.id);
    const p1 = await createPaymentOrder(db, ramu, ci.id);
    await db.run(sql`UPDATE payments SET status = 'FAILED' WHERE id = ${p1.paymentId}`);
    const p2 = await createPaymentOrder(db, ramu, ci.id);
    const hook = (order: string, amount: number, pay: string, evt: string) => {
      const rawBody = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: pay, order_id: order, amount, currency: "INR", status: "captured" } } } });
      return handleRazorpayWebhook(racer(), { rawBody, signature: hmacHex(FAKE_WEBHOOK_SECRET, rawBody), eventId: evt });
    };
    const caps = await settled([
      () => hook(p1.razorpayOrderId, p1.amountPaise, `pay_${run}a${round}`, `evt_${run}a${round}`),
      () => hook(p2.razorpayOrderId, p2.amountPaise, `pay_${run}b${round}`, `evt_${run}b${round}`),
      () => hook(p2.razorpayOrderId, p2.amountPaise, `pay_${run}b${round}`, `evt_${run}b${round}`), // redelivery of the same event
    ]);
    const paidRows = await n(sql`SELECT count(*) AS v FROM payments WHERE customer_invoice_id = ${ci.id} AND status = 'PAID'`);
    const errs = caps.filter((r) => r.status === "rejected").length;
    check(`r${round} duplicate-capture: exactly one PAID attempt, no thrown errors`, paidRows === 1 && errs === 0, `paid=${paidRows} errors=${errs}`);
  }
}

main().finally(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
}).then(
  () => {
    if (failures.length) {
      console.error(`${failures.length} check(s) FAILED`);
      process.exit(1);
    }
    console.log("All concurrency checks passed");
    process.exit(0);
  },
  (e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  },
);
