import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { migrate } from "drizzle-orm/libsql/migrator";
import { eq, sql } from "drizzle-orm";

const state = { headers: new Headers(), cookies: new Map<string, string>() };
vi.mock("next/headers", () => ({
  headers: async () => state.headers,
  cookies: async () => ({ get: (n: string) => (state.cookies.has(n) ? { name: n, value: state.cookies.get(n) } : undefined) }),
}));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT:${to}`); } }));

const APP = "http://localhost:3000";
const dir = mkdtempSync(path.join(tmpdir(), "cl-qav18-"));
process.env.DATABASE_URL = `file:${path.join(dir, "qa.db")}`;
process.env.APP_URL = APP;
process.env.ACTION_MAX_PER_MIN = "5000";
process.env.PAYMENT_GATEWAY = "fake";
process.env.E2E = "1";
delete process.env.VERCEL;
delete process.env.RAZORPAY_WEBHOOK_SECRET;

type Ctx = { params: Promise<{ id: string }> };
type Route = (req: Request, ctx?: Ctx) => Promise<Response>;
let db: ReturnType<typeof import("@/server/db/client").getDb>;
let schema: typeof import("@/server/db/schema");
let svc: typeof import("@/server/services/users");
let sess: typeof import("@/server/auth/session");
let sig: typeof import("@/server/payments/signature");
let gw: typeof import("@/server/payments/gateway");
let R: Record<string, Route>;

type Role = "CUSTOMER" | "DISTRIBUTOR" | "PROVIDER";
type U = { id: string };
let n = 0;
async function mk(role: Role, name: string) {
  n += 1;
  const u = await svc.registerUser(db, { name, email: `u${n}-${name.toLowerCase()}@x.com`, password: "password123", role, phone: "9876543210", businessName: `${name} Biz`, city: "Pune" } as never);
  await db.update(schema.users).set({ status: "ACTIVE" }).where(eq(schema.users.id, u.id));
  return u;
}
const as = async (u: U) => { state.cookies.set("cl_session", (await sess.createSession(db, u.id, 1)).token); };
const call = (r: string, p: string, method: "GET" | "POST", body?: unknown, id?: string) =>
  R[r](new Request(`${APP}${p}`, { method, body: body === undefined ? undefined : JSON.stringify(body) }), id ? { params: Promise.resolve({ id }) } : undefined);
const today = () => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

let giri: U, other: U, ramu: U, sita: U;
let seq = 0;
/** A DELIVERED order for ramu/giri, 10 t, delivered now. */
async function deliveredOrder(customer = ramu, distributor = giri, status = "DELIVERED"): Promise<string> {
  seq += 1;
  const id = `ord-${seq}-${Math.random().toString(16).slice(2, 8)}`;
  const now = Date.now();
  await db.run(sql`INSERT INTO orders (id, customer_id, distributor_id, qty_kg, address, city, pincode, needed_by, status, delivered_at, created_at, updated_at)
    VALUES (${id}, ${customer.id}, ${distributor.id}, 10000, 'Addr', 'Pune', '411001', ${today()}, ${status}, ${now}, ${now}, ${now})`);
  return id;
}
const body = (extra: Record<string, unknown> = {}) => ({ invoiceNo: `inv-${++seq}`, invoiceDate: today(), ratePerTonne: "6500", ...extra });
async function invoiceFor(orderId: string, request = true): Promise<string> {
  await as(giri);
  const r = await call("invoice", `/api/orders/${orderId}/invoice`, "POST", body(), orderId);
  const id = ((await r.json()) as { data: { id: string } }).data.id;
  if (request) await call("request", `/api/customer-invoices/${id}/payment-request`, "POST", undefined, id);
  return id;
}
const q = async <T,>(query: ReturnType<typeof sql>) => (await db.all<T>(query));
const invStatus = async (id: string) => (await q<{ status: string }>(sql`SELECT status FROM customer_invoices WHERE id = ${id}`))[0].status;
const ordStatus = async (id: string) => (await q<{ status: string }>(sql`SELECT status FROM orders WHERE id = ${id}`))[0].status;

let evSeq = 0;
function webhook(event: string, rzpOrder: string, o: { amount: number; paymentId?: string; eventId?: string; secret?: string; currency?: string; badSig?: boolean }) {
  const raw = JSON.stringify({ event, payload: { payment: { entity: { id: o.paymentId ?? "pay_A", order_id: rzpOrder, amount: o.amount, currency: o.currency ?? "INR", status: "captured", error_description: "card declined" } } } });
  const signature = o.badSig ? "0".repeat(64) : sig.hmacHex(o.secret ?? sig.FAKE_WEBHOOK_SECRET, raw);
  evSeq += 1;
  return R.webhook(new Request(`${APP}/api/webhooks/razorpay`, { method: "POST", body: raw, headers: { "x-razorpay-signature": signature, "x-razorpay-event-id": o.eventId ?? `evt_${evSeq}` } }));
}
async function startPayment(invoiceId: string, customer = ramu) {
  await as(customer);
  const r = await call("payOrder", "/api/payments/order", "POST", { customerInvoiceId: invoiceId });
  return { status: r.status, ...(((await r.json()) as { data?: { paymentId: string; razorpayOrderId: string; amountPaise: number } }).data ?? ({} as never)) };
}

beforeAll(async () => {
  db = (await import("@/server/db/client")).getDb();
  schema = await import("@/server/db/schema");
  svc = await import("@/server/services/users");
  sess = await import("@/server/auth/session");
  sig = await import("@/server/payments/signature");
  gw = await import("@/server/payments/gateway");
  await migrate(db, { migrationsFolder: path.resolve(import.meta.dirname, "../../drizzle") });
  R = {
    invoice: (await import("@/app/api/orders/[id]/invoice/route")).POST as unknown as Route,
    request: (await import("@/app/api/customer-invoices/[id]/payment-request/route")).POST as unknown as Route,
    list: (await import("@/app/api/customer-invoices/route")).GET as unknown as Route,
    payOrder: (await import("@/app/api/payments/order/route")).POST as unknown as Route,
    verify: (await import("@/app/api/payments/verify/route")).POST as unknown as Route,
    refresh: (await import("@/app/api/payments/[id]/refresh/route")).POST as unknown as Route,
    status: (await import("@/app/api/payments/[id]/status/route")).GET as unknown as Route,
    history: (await import("@/app/api/payments/route")).GET as unknown as Route,
    webhook: (await import("@/app/api/webhooks/razorpay/route")).POST as unknown as Route,
    balances: (await import("@/app/api/balances/route")).GET as unknown as Route,
  };
  state.headers = new Headers({ origin: APP });
  giri = await mk("DISTRIBUTOR", "Giri");
  other = await mk("DISTRIBUTOR", "Other");
  ramu = await mk("CUSTOMER", "Ramu");
  sita = await mk("CUSTOMER", "Sita");
});
afterAll(() => { gw.setGatewayForTests(undefined); rmSync(dir, { recursive: true, force: true }); });

describe("QA V18 edge cases", () => {
  it("money CAST: odd qty x fractional rate rounds half up in integer paise", async () => {
    const o = await deliveredOrder();
    await db.run(sql`UPDATE orders SET qty_kg = 12345 WHERE id = ${o}`);
    await as(giri);
    const r = await call("invoice", `/api/orders/${o}/invoice`, "POST", body({ ratePerTonne: "6500.55" }), o);
    expect(r.status).toBe(201);
    const { data } = (await r.json()) as { data: { id: string; amountPaise: number } };
    const expected = Math.floor((12345 * 650055 + 500) / 1000);
    expect(data.amountPaise).toBe(expected);
    const [row] = await q<{ a: number; t: string }>(sql`SELECT amount_paise AS a, typeof(amount_paise) AS t FROM customer_invoices WHERE id = ${data.id}`);
    expect(row).toEqual({ a: expected, t: "integer" });
  });
  it("invoice date: day of delivery ok, day before 422 (IST)", async () => {
    const o = await deliveredOrder();
    const yesterday = new Date(Date.now() + 330 * 60_000 - 86_400_000).toISOString().slice(0, 10);
    await as(giri);
    expect((await call("invoice", `/api/orders/${o}/invoice`, "POST", body({ invoiceDate: yesterday }), o)).status).toBe(422);
    expect((await call("invoice", `/api/orders/${o}/invoice`, "POST", body({ invoiceDate: today() }), o)).status).toBe(201);
    const o2 = await deliveredOrder();
    expect((await call("invoice", `/api/orders/${o2}/invoice`, "POST", body({ invoiceDate: "2999-01-01" }), o2)).status).toBe(400);
    expect((await call("invoice", `/api/orders/${o2}/invoice`, "POST", body({ invoiceNo: "" }), o2)).status).toBe(400);
    expect((await call("invoice", `/api/orders/${o2}/invoice`, "POST", body({ invoiceNo: "x".repeat(500) }), o2)).status).toBe(400);
  });
  it("same invoice number allowed for a different distributor", async () => {
    const a = await deliveredOrder();
    const b = await deliveredOrder(ramu, other);
    await as(giri);
    expect((await call("invoice", `/api/orders/${a}/invoice`, "POST", body({ invoiceNo: "SHARED-1" }), a)).status).toBe(201);
    await as(other);
    expect((await call("invoice", `/api/orders/${b}/invoice`, "POST", body({ invoiceNo: "SHARED-1" }), b)).status).toBe(201);
  });
  it("cross-customer: another customer can not verify, refresh, status or pay; other distributor sees no invoices", async () => {
    const o = await deliveredOrder();
    const id = await invoiceFor(o);
    const p = await startPayment(id);
    await as(sita);
    expect((await call("refresh", `/api/payments/${p.paymentId}/refresh`, "POST", undefined, p.paymentId)).status).toBe(404);
    expect((await call("status", `/api/payments/${p.paymentId}/status`, "GET", undefined, p.paymentId)).status).toBe(404);
    await as(other);
    const l = (await (await call("list", "/api/customer-invoices", "GET")).json()) as { data: Array<{ id: string }> };
    expect(l.data.some((x) => x.id === id)).toBe(false);
    expect((await call("payOrder", "/api/payments/order", "POST", { customerInvoiceId: id })).status).toBeGreaterThanOrEqual(403);
    await as(giri);
    expect((await call("payOrder", "/api/payments/order", "POST", { customerInvoiceId: id })).status).toBeGreaterThanOrEqual(403);
  });
  it("unauthenticated and cross-origin requests are refused", async () => {
    const o = await deliveredOrder();
    const id = await invoiceFor(o);
    state.cookies.delete("cl_session");
    expect((await call("payOrder", "/api/payments/order", "POST", { customerInvoiceId: id })).status).toBe(401);
    expect((await call("history", "/api/payments", "GET")).status).toBe(401);
    await as(ramu);
    const saved = state.headers;
    state.headers = new Headers({ origin: "http://evil.example" });
    expect((await call("payOrder", "/api/payments/order", "POST", { customerInvoiceId: id })).status).toBe(403);
    state.headers = saved;
  });
  it("payment order rejects client-supplied amount and junk ids", async () => {
    await as(ramu);
    expect((await call("payOrder", "/api/payments/order", "POST", { customerInvoiceId: "x", amountPaise: 1 })).status).toBe(400);
    expect((await call("payOrder", "/api/payments/order", "POST", { customerInvoiceId: "../../etc" })).status).toBe(400);
    expect((await call("payOrder", "/api/payments/order", "POST", { customerInvoiceId: "nope" })).status).toBe(404);
  });
  it("webhook: wrong amount for an AUTHORIZED attempt does not pay; right amount after verify pays; paid twice recorded", async () => {
    const o = await deliveredOrder();
    const id = await invoiceFor(o);
    const p = await startPayment(id);
    await call("verify", "/api/payments/verify", "POST", { razorpayOrderId: p.razorpayOrderId, razorpayPaymentId: "pay_Q", razorpaySignature: "fake_checkout_signature" });
    await webhook("payment.captured", p.razorpayOrderId, { amount: p.amountPaise + 1, paymentId: "pay_Q" });
    expect(await invStatus(id)).toBe("PAYMENT_REQUESTED");
    await webhook("payment.captured", p.razorpayOrderId, { amount: p.amountPaise, paymentId: "pay_Q" });
    expect(await invStatus(id)).toBe("PAID");
    expect(await ordStatus(o)).toBe("PAID");
  });
  it("webhook with tampered body but original signature is 401", async () => {
    const o = await deliveredOrder();
    const id = await invoiceFor(o);
    const p = await startPayment(id);
    const raw = JSON.stringify({ event: "payment.captured", payload: { payment: { entity: { id: "pay_T", order_id: p.razorpayOrderId, amount: p.amountPaise, currency: "INR" } } } });
    const s = sig.hmacHex(sig.FAKE_WEBHOOK_SECRET, raw);
    const r = await R.webhook(new Request(`${APP}/api/webhooks/razorpay`, { method: "POST", body: raw.replace("pay_T", "pay_U"), headers: { "x-razorpay-signature": s, "x-razorpay-event-id": "evt_tamper" } }));
    expect(r.status).toBe(401);
    const none = await R.webhook(new Request(`${APP}/api/webhooks/razorpay`, { method: "POST", body: raw, headers: { "x-razorpay-event-id": "evt_nosig" } }));
    expect(none.status).toBe(401);
    expect(await invStatus(id)).toBe("PAYMENT_REQUESTED");
  });
  it("concurrent duplicate webhooks pay exactly once", async () => {
    const o = await deliveredOrder();
    const id = await invoiceFor(o);
    const p = await startPayment(id);
    const rs = await Promise.all([1, 2, 3, 4, 5].map(() => webhook("payment.captured", p.razorpayOrderId, { amount: p.amountPaise, eventId: "evt_conc" })));
    expect(rs.every((r) => r.status === 200)).toBe(true);
    expect((await q<{ n: number }>(sql`SELECT count(*) AS n FROM webhook_events WHERE provider_event_id = 'evt_conc'`))[0].n).toBe(1);
    expect((await q<{ n: number }>(sql`SELECT count(*) AS n FROM payments WHERE customer_invoice_id = ${id} AND status = 'PAID'`))[0].n).toBe(1);
    expect(await invStatus(id)).toBe("PAID");
  });
  it("no card/UPI columns in payments or webhook_events tables", async () => {
    const cols = [...(await q<{ name: string }>(sql`SELECT name FROM pragma_table_info('payments')`)), ...(await q<{ name: string }>(sql`SELECT name FROM pragma_table_info('webhook_events')`))].map((c) => c.name.toLowerCase());
    expect(cols.filter((c) => /card|upi|vpa|cvv|pan|token/.test(c))).toEqual([]);
  });
  it("receivable: invoiced minus paid; paid only after webhook; other distributor unaffected", async () => {
    await as(other);
    const before = (await (await call("balances", "/api/balances", "GET")).json()) as { data: { receivable: { invoicedPaise: number; paidPaise: number; toReceivePaise: number } } };
    const o = await deliveredOrder(ramu, other);
    await as(other);
    const r = await call("invoice", `/api/orders/${o}/invoice`, "POST", body({ ratePerTonne: "100" }), o);
    const { data } = (await r.json()) as { data: { id: string } };
    await call("request", `/api/customer-invoices/${data.id}/payment-request`, "POST", undefined, data.id);
    const mid = (await (await call("balances", "/api/balances", "GET")).json()) as typeof before;
    expect(mid.data.receivable.invoicedPaise - before.data.receivable.invoicedPaise).toBe(100_000);
    expect(mid.data.receivable.toReceivePaise - before.data.receivable.toReceivePaise).toBe(100_000);
    const p = await startPayment(data.id);
    await call("verify", "/api/payments/verify", "POST", { razorpayOrderId: p.razorpayOrderId, razorpayPaymentId: "pay_Z", razorpaySignature: "fake_checkout_signature" });
    await as(other);
    const mid2 = (await (await call("balances", "/api/balances", "GET")).json()) as typeof before;
    expect(mid2.data.receivable.toReceivePaise).toBe(mid.data.receivable.toReceivePaise);
    await webhook("payment.captured", p.razorpayOrderId, { amount: p.amountPaise, paymentId: "pay_Z" });
    const after = (await (await call("balances", "/api/balances", "GET")).json()) as typeof before;
    expect(after.data.receivable.toReceivePaise).toBe(before.data.receivable.toReceivePaise);
    expect(after.data.receivable.paidPaise - before.data.receivable.paidPaise).toBe(100_000);
  });

  async function twoAttempts() {
    const o = await deliveredOrder();
    const id = await invoiceFor(o);
    const p1 = await startPayment(id);
    await webhook("payment.failed", p1.razorpayOrderId, { amount: p1.amountPaise, paymentId: "pay_x1" });
    const p2 = await startPayment(id);
    return { o, id, p1, p2 };
  }
  it("fix-loop: late capture of an old attempt pays and supersedes the open one; later capture is duplicate_payment with NEEDS_REFUND (distributor only)", async () => {
    const { id, p1, p2 } = await twoAttempts();
    await webhook("payment.captured", p1.razorpayOrderId, { amount: p1.amountPaise, paymentId: "pay_late1" });
    expect(await invStatus(id)).toBe("PAID");
    const [s2] = await q<{ status: string; failure_reason: string }>(sql`SELECT status, failure_reason FROM payments WHERE id = ${p2.paymentId}`);
    expect(s2).toEqual({ status: "FAILED", failure_reason: "superseded" });
    const d = await webhook("payment.captured", p2.razorpayOrderId, { amount: p2.amountPaise, paymentId: "pay_late2" });
    expect(((await d.json()) as { data: { result: string } }).data.result).toBe("duplicate_payment");
    const [s2b] = await q<{ status: string; failure_reason: string }>(sql`SELECT status, failure_reason FROM payments WHERE id = ${p2.paymentId}`);
    expect(s2b.failure_reason).toMatch(/^NEEDS_REFUND:/);
    expect(await invStatus(id)).toBe("PAID");
    await as(giri);
    const g = (await (await call("list", "/api/customer-invoices", "GET")).json()) as { data: Array<{ id: string; needsRefund: boolean }> };
    expect(g.data.find((x) => x.id === id)?.needsRefund).toBe(true);
    await as(ramu);
    const c = (await (await call("list", "/api/customer-invoices", "GET")).json()) as { data: Array<{ id: string; needsRefund: boolean }> };
    expect(c.data.find((x) => x.id === id)?.needsRefund).toBe(false);
  });
  it("fix-loop: racing captures on two attempts never 500; exactly one PAID", async () => {
    const o = await deliveredOrder();
    const id = await invoiceFor(o);
    const p1 = await startPayment(id);
    await webhook("payment.failed", p1.razorpayOrderId, { amount: p1.amountPaise, paymentId: "pay_r0" });
    const p2 = await startPayment(id);
    const rs = await Promise.all([
      webhook("payment.captured", p1.razorpayOrderId, { amount: p1.amountPaise, paymentId: "pay_r1" }),
      webhook("payment.captured", p2.razorpayOrderId, { amount: p2.amountPaise, paymentId: "pay_r2" }),
    ]);
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
    const results = await Promise.all(rs.map(async (r) => ((await r.json()) as { data: { result: string } }).data.result));
    expect(results.filter((x) => x === "paid")).toHaveLength(1);
    expect(results.filter((x) => x === "duplicate_payment")).toHaveLength(1);
    expect((await q<{ n: number }>(sql`SELECT count(*) AS n FROM payments WHERE customer_invoice_id = ${id} AND status = 'PAID'`))[0].n).toBe(1);
    expect(await invStatus(id)).toBe("PAID");
  });
  it("fix-loop: webhook body cap counts bytes (chunked, no content-length) and returns 413", async () => {
    const big = "x".repeat(2 * 1024 * 1024);
    const stream = new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(big)); c.close(); } });
    const r = await R.webhook(new Request(`${APP}/api/webhooks/razorpay`, { method: "POST", body: stream, duplex: "half", headers: { "x-razorpay-signature": "0".repeat(64), "x-razorpay-event-id": "evt_big" } } as RequestInit));
    expect(r.status).toBe(413);
    // multi-byte chars: character count under the cap but byte count over it
    const mb = "\u20ac".repeat(400_000);
    const r2 = await R.webhook(new Request(`${APP}/api/webhooks/razorpay`, { method: "POST", body: mb, headers: { "x-razorpay-signature": "0".repeat(64), "x-razorpay-event-id": "evt_mb" } }));
    expect(r2.status).toBe(413);
  });
});
