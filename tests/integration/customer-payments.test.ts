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
const dir = mkdtempSync(path.join(tmpdir(), "cl-cpay-"));
process.env.DATABASE_URL = `file:${path.join(dir, "cp.db")}`;
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

describe("customer invoice", () => {
  it("creates from a DELIVERED order: qty from order, amount in SQL, order -> INVOICED", async () => {
    const o = await deliveredOrder();
    await as(giri);
    const r = await call("invoice", `/api/orders/${o}/invoice`, "POST", body({ ratePerTonne: "6500.50" }), o);
    expect(r.status).toBe(201);
    const { data } = (await r.json()) as { data: { id: string; amountPaise: number } };
    expect(data.amountPaise).toBe(6_500_500); // 10 t x 6500.50
    const [row] = await q<{ qty_kg: number; amount_paise: number; status: string }>(sql`SELECT qty_kg, amount_paise, status FROM customer_invoices WHERE id = ${data.id}`);
    expect(row).toMatchObject({ qty_kg: 10000, amount_paise: 6_500_500, status: "ISSUED" });
    expect(await ordStatus(o)).toBe("INVOICED");
  });
  it("409 ALREADY_INVOICED on a second invoice, also when racing", async () => {
    const o = await deliveredOrder();
    await as(giri);
    const rs = await Promise.all([1, 2, 3].map(() => call("invoice", `/api/orders/${o}/invoice`, "POST", body(), o)));
    expect(rs.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    const again = await call("invoice", `/api/orders/${o}/invoice`, "POST", body(), o);
    expect(((await again.json()) as { code: string }).code).toBe("ALREADY_INVOICED");
  });
  it("409 DUPLICATE_INVOICE_NO within a distributor, and the order stays DELIVERED", async () => {
    const a = await deliveredOrder();
    const b = await deliveredOrder();
    await as(giri);
    await call("invoice", `/api/orders/${a}/invoice`, "POST", body({ invoiceNo: "DUP-1" }), a);
    const r = await call("invoice", `/api/orders/${b}/invoice`, "POST", body({ invoiceNo: "dup-1" }), b);
    expect(r.status).toBe(409);
    expect(((await r.json()) as { code: string }).code).toBe("DUPLICATE_INVOICE_NO");
    expect(await ordStatus(b)).toBe("DELIVERED");
  });
  it("rejects non-delivered orders, dates before delivery, other distributors, client qty/amount and the wrong role", async () => {
    const dispatched = await deliveredOrder(ramu, giri, "DISPATCHED");
    const o = await deliveredOrder();
    await as(giri);
    expect((await call("invoice", `/api/orders/${dispatched}/invoice`, "POST", body(), dispatched)).status).toBe(409);
    expect((await call("invoice", `/api/orders/${o}/invoice`, "POST", body({ invoiceDate: "2000-01-02" }), o)).status).toBe(422);
    expect((await call("invoice", `/api/orders/${o}/invoice`, "POST", body({ qtyTonnes: "99" }), o)).status).toBe(400);
    expect((await call("invoice", `/api/orders/${o}/invoice`, "POST", body({ amount: 1 }), o)).status).toBe(400);
    expect((await call("invoice", `/api/orders/${o}/invoice`, "POST", body({ ratePerTonne: "0" }), o)).status).toBe(400);
    await as(other);
    expect((await call("invoice", `/api/orders/${o}/invoice`, "POST", body(), o)).status).toBe(404);
    await as(ramu);
    expect((await call("invoice", `/api/orders/${o}/invoice`, "POST", body(), o)).status).toBe(403);
    expect(await ordStatus(o)).toBe("DELIVERED");
  });
  it("payment request: ISSUED -> PAYMENT_REQUESTED once; other distributor 404; lists are own only", async () => {
    const o = await deliveredOrder();
    const id = await invoiceFor(o, false);
    await as(other);
    expect((await call("request", `/api/customer-invoices/${id}/payment-request`, "POST", undefined, id)).status).toBe(404);
    await as(giri);
    expect((await call("request", `/api/customer-invoices/${id}/payment-request`, "POST", undefined, id)).status).toBe(200);
    expect((await call("request", `/api/customer-invoices/${id}/payment-request`, "POST", undefined, id)).status).toBe(409);
    expect(await invStatus(id)).toBe("PAYMENT_REQUESTED");
    await as(sita);
    expect(((await (await call("list", "/api/customer-invoices", "GET")).json()) as { data: unknown[] }).data).toHaveLength(0);
    await as(ramu);
    const mine = (await (await call("list", "/api/customer-invoices", "GET")).json()) as { data: Array<{ id: string }> };
    expect(mine.data.some((x) => x.id === id)).toBe(true);
  });
});

describe("payments and webhook", () => {
  it("needs PAYMENT_REQUESTED; other customers get 404; double-click makes one attempt", async () => {
    const o = await deliveredOrder();
    const id = await invoiceFor(o, false);
    expect((await startPayment(id)).status).toBe(409);
    await as(giri);
    await call("request", `/api/customer-invoices/${id}/payment-request`, "POST", undefined, id);
    expect((await startPayment(id, sita)).status).toBe(404);
    await as(ramu);
    const rs = await Promise.all([1, 2, 3, 4].map(() => call("payOrder", "/api/payments/order", "POST", { customerInvoiceId: id })));
    const ok = await Promise.all(rs.filter((r) => r.status === 200).map(async (r) => ((await r.json()) as { data: { paymentId: string; razorpayOrderId: string } }).data));
    expect(ok.length).toBeGreaterThanOrEqual(1);
    expect(new Set(ok.map((x) => x.paymentId)).size).toBe(1);
    expect((await q<{ n: number }>(sql`SELECT count(*) AS n FROM payments WHERE customer_invoice_id = ${id} AND status = 'CREATED'`))[0].n).toBe(1);
    const again = await startPayment(id);
    expect(again.paymentId).toBe(ok[0].paymentId);
    expect(again.razorpayOrderId).toBe(ok[0].razorpayOrderId);
  });

  it("browser callback never sets PAID: verify only AUTHORIZES; bad signature is rejected", async () => {
    const o = await deliveredOrder();
    const id = await invoiceFor(o);
    const p = await startPayment(id);
    const bad = await call("verify", "/api/payments/verify", "POST", { razorpayOrderId: p.razorpayOrderId, razorpayPaymentId: "pay_V", razorpaySignature: "nope" });
    expect(bad.status).toBe(400);
    const ok = await call("verify", "/api/payments/verify", "POST", { razorpayOrderId: p.razorpayOrderId, razorpayPaymentId: "pay_V", razorpaySignature: "fake_checkout_signature" });
    expect(((await ok.json()) as { data: { status: string } }).data.status).toBe("AUTHORIZED");
    expect(await invStatus(id)).toBe("PAYMENT_REQUESTED");
    expect(await ordStatus(o)).toBe("INVOICED");
    await as(sita);
    expect((await call("verify", "/api/payments/verify", "POST", { razorpayOrderId: p.razorpayOrderId, razorpayPaymentId: "pay_V", razorpaySignature: "fake_checkout_signature" })).status).toBe(404);
  });

  it("webhook: bad HMAC 401 changes nothing; valid captured -> PAID invoice + order; duplicate is a no-op", async () => {
    const o = await deliveredOrder();
    const id = await invoiceFor(o);
    const p = await startPayment(id);
    expect((await webhook("payment.captured", p.razorpayOrderId, { amount: p.amountPaise, badSig: true })).status).toBe(401);
    expect((await webhook("payment.captured", p.razorpayOrderId, { amount: p.amountPaise, secret: "wrong" })).status).toBe(401);
    expect(await invStatus(id)).toBe("PAYMENT_REQUESTED");
    expect((await q<{ n: number }>(sql`SELECT count(*) AS n FROM webhook_events WHERE razorpay_order_id = ${p.razorpayOrderId}`))[0].n).toBe(0);

    const first = await webhook("payment.captured", p.razorpayOrderId, { amount: p.amountPaise, eventId: "evt_dup_1" });
    expect(((await first.json()) as { data: { result: string; duplicate: boolean } }).data).toEqual({ duplicate: false, result: "paid" });
    expect(await invStatus(id)).toBe("PAID");
    expect(await ordStatus(o)).toBe("PAID");
    const [pay] = await q<{ status: string; razorpay_payment_id: string }>(sql`SELECT status, razorpay_payment_id FROM payments WHERE id = ${p.paymentId}`);
    expect(pay).toEqual({ status: "PAID", razorpay_payment_id: "pay_A" });

    const dup = await webhook("payment.captured", p.razorpayOrderId, { amount: p.amountPaise, eventId: "evt_dup_1" });
    expect(((await dup.json()) as { data: { duplicate: boolean } }).data.duplicate).toBe(true);
    const replay = await webhook("payment.captured", p.razorpayOrderId, { amount: p.amountPaise });
    expect(((await replay.json()) as { data: { result: string } }).data.result).toBe("already_paid");
    expect((await q<{ n: number }>(sql`SELECT count(*) AS n FROM payments WHERE customer_invoice_id = ${id} AND status = 'PAID'`))[0].n).toBe(1);
    // a paid invoice can not start another payment
    expect((await startPayment(id)).status).toBe(409);
  });

  it("webhook amount or currency mismatch is recorded and changes nothing", async () => {
    const o = await deliveredOrder();
    const id = await invoiceFor(o);
    const p = await startPayment(id);
    const r = await webhook("payment.captured", p.razorpayOrderId, { amount: p.amountPaise - 1 });
    expect(((await r.json()) as { data: { result: string } }).data.result).toBe("amount_mismatch");
    const c = await webhook("payment.captured", p.razorpayOrderId, { amount: p.amountPaise, currency: "USD" });
    expect(((await c.json()) as { data: { result: string } }).data.result).toBe("amount_mismatch");
    expect(await invStatus(id)).toBe("PAYMENT_REQUESTED");
    expect(await ordStatus(o)).toBe("INVOICED");
  });

  it("failure leaves the invoice unpaid and retry works with a fresh attempt, then pays", async () => {
    const o = await deliveredOrder();
    const id = await invoiceFor(o);
    const p1 = await startPayment(id);
    const f = await webhook("payment.failed", p1.razorpayOrderId, { amount: p1.amountPaise, paymentId: "pay_F" });
    expect(((await f.json()) as { data: { result: string } }).data.result).toBe("failed");
    expect(await invStatus(id)).toBe("PAYMENT_REQUESTED");
    const [failed] = await q<{ status: string; failure_reason: string }>(sql`SELECT status, failure_reason FROM payments WHERE id = ${p1.paymentId}`);
    expect(failed).toEqual({ status: "FAILED", failure_reason: "card declined" });
    const p2 = await startPayment(id);
    expect(p2.status).toBe(200);
    expect(p2.paymentId).not.toBe(p1.paymentId);
    await webhook("payment.captured", p2.razorpayOrderId, { amount: p2.amountPaise, paymentId: "pay_B" });
    expect(await invStatus(id)).toBe("PAID");
    // a late failure for the first attempt can not undo PAID
    await webhook("payment.failed", p2.razorpayOrderId, { amount: p2.amountPaise, paymentId: "pay_B" });
    expect(await invStatus(id)).toBe("PAID");
    expect((await q<{ status: string }>(sql`SELECT status FROM payments WHERE id = ${p2.paymentId}`))[0].status).toBe("PAID");
  });

  it("unknown order, unsupported events and malformed bodies are handled without state change", async () => {
    const u = await webhook("payment.captured", "order_nope", { amount: 100 });
    expect(((await u.json()) as { data: { result: string } }).data.result).toBe("unknown_order");
    const i = await webhook("refund.processed", "order_nope", { amount: 100 });
    expect(((await i.json()) as { data: { result: string } }).data.result).toBe("ignored");
    const raw = "not json";
    const bad = await R.webhook(new Request(`${APP}/api/webhooks/razorpay`, { method: "POST", body: raw, headers: { "x-razorpay-signature": sig.hmacHex(sig.FAKE_WEBHOOK_SECRET, raw), "x-razorpay-event-id": "evt_bad" } }));
    expect(bad.status).toBe(400);
    const noId = await R.webhook(new Request(`${APP}/api/webhooks/razorpay`, { method: "POST", body: "{}", headers: { "x-razorpay-signature": sig.hmacHex(sig.FAKE_WEBHOOK_SECRET, "{}") } }));
    expect(noId.status).toBe(400);
  });

  it("gateway failure marks the attempt FAILED so a retry works; refresh can fail but never pay", async () => {
    const o = await deliveredOrder();
    const id = await invoiceFor(o);
    const real = gw.getGateway();
    let mode: "down" | "captured" | "failed" = "down";
    gw.setGatewayForTests({
      ...real,
      createOrder: async () => { if (mode === "down") throw new Error("network"); return { orderId: `order_t_${seq}` }; },
      fetchOrderPayments: async () => [{ id: "pay_R", status: mode === "captured" ? "captured" : "failed" }],
    });
    try {
      await as(ramu);
      const r = await call("payOrder", "/api/payments/order", "POST", { customerInvoiceId: id });
      expect(r.status).toBe(500);
      expect((await q<{ status: string }>(sql`SELECT status FROM payments WHERE customer_invoice_id = ${id}`))[0].status).toBe("FAILED");
      mode = "captured";
      const p = await startPayment(id);
      expect(p.status).toBe(200);
      const rc = await call("refresh", `/api/payments/${p.paymentId}/refresh`, "POST", undefined, p.paymentId);
      expect(((await rc.json()) as { data: { status: string } }).data.status).toBe("AUTHORIZED");
      expect(await invStatus(id)).toBe("PAYMENT_REQUESTED");
      expect(((await (await call("status", `/api/payments/${p.paymentId}/status`, "GET", undefined, p.paymentId)).json()) as { data: { status: string } }).data.status).toBe("AUTHORIZED");
      // an AUTHORIZED attempt blocks a second one while the webhook is awaited
      expect((await startPayment(id)).status).toBe(409);
      mode = "failed";
      const rf = await call("refresh", `/api/payments/${p.paymentId}/refresh`, "POST", undefined, p.paymentId);
      expect(((await rf.json()) as { data: { status: string } }).data.status).toBe("FAILED");
      expect(await invStatus(id)).toBe("PAYMENT_REQUESTED");
    } finally {
      gw.setGatewayForTests(undefined);
    }
  });

  it("payment history and receivable balance reflect PAID only", async () => {
    await as(ramu);
    const h = (await (await call("history", "/api/payments", "GET")).json()) as { data: Array<{ status: string }> };
    expect(h.data.length).toBeGreaterThan(0);
    await as(sita);
    expect(((await (await call("history", "/api/payments", "GET")).json()) as { data: unknown[] }).data).toHaveLength(0);
    await as(giri);
    const b = (await (await call("balances", "/api/balances", "GET")).json()) as { data: { receivable: { invoicedPaise: number; paidPaise: number; toReceivePaise: number } } };
    const [sum] = await q<{ total: number; paid: number }>(sql`SELECT SUM(amount_paise) AS total, SUM(CASE WHEN status = 'PAID' THEN amount_paise ELSE 0 END) AS paid FROM customer_invoices WHERE distributor_id = ${giri.id}`);
    expect(b.data.receivable).toMatchObject({ invoicedPaise: sum.total, paidPaise: sum.paid, toReceivePaise: sum.total - sum.paid });
    expect(sum.paid).toBeGreaterThan(0);
  });
});

describe("fix loop 1", () => {
  const asUser = async (u: U) => (await db.select().from(schema.users).where(eq(schema.users.id, u.id)))[0];
  const payload = (event: string, body: unknown, eventId: string) => {
    const raw = JSON.stringify({ event, payload: body });
    return R.webhook(new Request(`${APP}/api/webhooks/razorpay`, { method: "POST", body: raw, headers: { "x-razorpay-signature": sig.hmacHex(sig.FAKE_WEBHOOK_SECRET, raw), "x-razorpay-event-id": eventId } }));
  };
  const result = async (r: Response) => ((await r.json()) as { data: { result: string; duplicate: boolean } }).data.result;
  const giriInvoice = async (id: string) => {
    await as(giri);
    const j = (await (await call("list", "/api/customer-invoices", "GET")).json()) as { data: Array<{ id: string; needsRefund: boolean }> };
    return j.data.find((x) => x.id === id);
  };

  it("two racing captures for one invoice: one PAID, the other recorded as duplicate_payment and flagged, no 500", async () => {
    const o = await deliveredOrder();
    const id = await invoiceFor(o);
    const p1 = await startPayment(id);
    await db.run(sql`UPDATE payments SET status = 'FAILED' WHERE id = ${p1.paymentId}`);
    const p2 = await startPayment(id);
    expect(p2.paymentId).not.toBe(p1.paymentId);
    const rs = await Promise.all([
      webhook("payment.captured", p1.razorpayOrderId, { amount: p1.amountPaise, paymentId: "pay_X1" }),
      webhook("payment.captured", p2.razorpayOrderId, { amount: p2.amountPaise, paymentId: "pay_X2" }),
    ]);
    expect(rs.map((r) => r.status)).toEqual([200, 200]);
    expect((await Promise.all(rs.map(result))).sort()).toEqual(["duplicate_payment", "paid"]);
    expect(await invStatus(id)).toBe("PAID");
    expect((await q<{ n: number }>(sql`SELECT count(*) AS n FROM payments WHERE customer_invoice_id = ${id} AND status = 'PAID'`))[0].n).toBe(1);
    expect((await q<{ n: number }>(sql`SELECT count(*) AS n FROM payments WHERE customer_invoice_id = ${id} AND failure_reason = 'NEEDS_REFUND:duplicate_payment'`))[0].n).toBe(1);
    expect((await giriInvoice(id))?.needsRefund).toBe(true);
    await as(ramu);
    const mine = (await (await call("list", "/api/customer-invoices", "GET")).json()) as { data: Array<{ id: string; needsRefund: boolean }> };
    expect(mine.data.find((x) => x.id === id)?.needsRefund).toBe(false);
  });

  it("paying fails the invoice's other open attempts as superseded; a late capture of one is flagged", async () => {
    const o = await deliveredOrder();
    const id = await invoiceFor(o);
    const a = await startPayment(id);
    await db.run(sql`UPDATE payments SET status = 'AUTHORIZED', updated_at = 1 WHERE id = ${a.paymentId}`);
    const b = await startPayment(id); // AUTHORIZED older than the hold does not block a retry
    expect(b.paymentId).not.toBe(a.paymentId);
    expect(await result(await webhook("payment.captured", b.razorpayOrderId, { amount: b.amountPaise, paymentId: "pay_B1" }))).toBe("paid");
    expect((await q<{ status: string; failure_reason: string }>(sql`SELECT status, failure_reason FROM payments WHERE id = ${a.paymentId}`))[0]).toEqual({ status: "FAILED", failure_reason: "superseded" });
    expect(await result(await webhook("payment.captured", a.razorpayOrderId, { amount: a.amountPaise, paymentId: "pay_A1" }))).toBe("duplicate_payment");
    expect(await invStatus(id)).toBe("PAID");
    expect((await giriInvoice(id))?.needsRefund).toBe(true);
  });

  it("amount mismatch is flagged NEEDS_REFUND on the attempt and visible to the distributor only", async () => {
    const o = await deliveredOrder();
    const id = await invoiceFor(o);
    const p = await startPayment(id);
    await webhook("payment.captured", p.razorpayOrderId, { amount: p.amountPaise + 1 });
    expect((await q<{ failure_reason: string }>(sql`SELECT failure_reason FROM payments WHERE id = ${p.paymentId}`))[0].failure_reason).toBe("NEEDS_REFUND:amount_mismatch");
    expect(await invStatus(id)).toBe("PAYMENT_REQUESTED");
    expect((await giriInvoice(id))?.needsRefund).toBe(true);
    // a later correct capture clears the flag
    await webhook("payment.captured", p.razorpayOrderId, { amount: p.amountPaise, paymentId: "pay_OK" });
    expect((await q<{ failure_reason: string | null }>(sql`SELECT failure_reason FROM payments WHERE id = ${p.paymentId}`))[0].failure_reason).toBeNull();
    expect((await giriInvoice(id))?.needsRefund).toBe(false);
  });

  it("AUTHORIZED blocks a new attempt inside AUTHORIZED_HOLD_MS and allows one after it", async () => {
    const pay = await import("@/server/services/payments");
    const o = await deliveredOrder();
    const id = await invoiceFor(o);
    const p = await startPayment(id);
    await db.run(sql`UPDATE payments SET status = 'AUTHORIZED', updated_at = 1000 WHERE id = ${p.paymentId}`);
    const user = await asUser(ramu);
    await expect(pay.createPaymentOrder(db, user as never, id, 1000 + pay.AUTHORIZED_HOLD_MS - 1)).rejects.toMatchObject({ code: "PAYMENT_CONFIRMING", httpStatus: 409 });
    const fresh = await pay.createPaymentOrder(db, user as never, id, 1000 + pay.AUTHORIZED_HOLD_MS + 1);
    expect(fresh.paymentId).not.toBe(p.paymentId);
  });

  it("an in-flight CREATED attempt without a gateway order is retried shortly, then abandoned after STALE_CREATED_MS", async () => {
    const pay = await import("@/server/services/payments");
    const o = await deliveredOrder();
    const id = await invoiceFor(o);
    const user = await asUser(ramu);
    await db.run(sql`INSERT INTO payments (id, customer_invoice_id, customer_id, distributor_id, amount_paise, currency, status, created_at, updated_at)
      SELECT 'stale-1', id, customer_id, distributor_id, amount_paise, 'INR', 'CREATED', 5000, 5000 FROM customer_invoices WHERE id = ${id}`);
    await expect(pay.createPaymentOrder(db, user as never, id, 5000 + pay.STALE_CREATED_MS - 1)).rejects.toMatchObject({ code: "PAYMENT_IN_PROGRESS", httpStatus: 409 });
    const next = await pay.createPaymentOrder(db, user as never, id, 5000 + pay.STALE_CREATED_MS + 1);
    expect(next.paymentId).not.toBe("stale-1");
    const [old] = await q<{ status: string; failure_reason: string }>(sql`SELECT status, failure_reason FROM payments WHERE id = 'stale-1'`);
    expect(old).toEqual({ status: "FAILED", failure_reason: "abandoned" });
  });

  it("order.paid (payment + order entities) marks PAID; an order-only shape is recorded as malformed", async () => {
    const o = await deliveredOrder();
    const id = await invoiceFor(o);
    const p = await startPayment(id);
    const orderOnly = await payload("order.paid", { order: { entity: { id: p.razorpayOrderId, amount_paid: p.amountPaise, currency: "INR", status: "paid" } } }, "evt_op_1");
    expect(await result(orderOnly)).toBe("malformed");
    expect(await invStatus(id)).toBe("PAYMENT_REQUESTED");
    const full = await payload("order.paid", {
      payment: { entity: { id: "pay_OP", order_id: p.razorpayOrderId, amount: p.amountPaise, currency: "INR", status: "captured" } },
      order: { entity: { id: p.razorpayOrderId, amount_paid: p.amountPaise, currency: "INR", status: "paid" } },
    }, "evt_op_2");
    expect(await result(full)).toBe("paid");
    expect(await invStatus(id)).toBe("PAID");
    expect(await ordStatus(o)).toBe("PAID");
  });

  it("webhook body over the byte cap is rejected with 413 (multi-byte bodies count as bytes)", async () => {
    const raw = "é".repeat(40 * 1024);
    const r = await R.webhook(new Request(`${APP}/api/webhooks/razorpay`, { method: "POST", body: raw, headers: { "x-razorpay-signature": sig.hmacHex(sig.FAKE_WEBHOOK_SECRET, raw), "x-razorpay-event-id": "evt_big" } }));
    expect(r.status).toBe(413);
  });
});
