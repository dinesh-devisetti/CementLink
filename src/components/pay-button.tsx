"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { formatPaise } from "@/lib/money";
import { Button } from "./ui";

/** Razorpay Checkout.js (test mode). The callback only asks the server to verify; "Paid" appears once the webhook has marked it. */

interface Order { paymentId: string; razorpayOrderId: string; amountPaise: number; currency: string; keyId: string; gateway: "razorpay" | "fake" }
interface CheckoutResponse { razorpay_order_id: string; razorpay_payment_id: string; razorpay_signature: string }
interface RazorpayInstance { open(): void; on(event: string, cb: () => void): void }
declare global {
  interface Window { Razorpay?: new (opts: Record<string, unknown>) => RazorpayInstance }
}

const POLL_MS = 3000;
const POLL_MAX = 10;
type Phase = "idle" | "starting" | "checkout" | "confirming" | "paid" | "failed" | "slow";

function loadCheckout(): Promise<void> {
  if (window.Razorpay) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://checkout.razorpay.com/v1/checkout.js";
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load the payment window"));
    document.head.appendChild(s);
  });
}

async function api<T>(url: string, method: "GET" | "POST", body?: unknown): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  try {
    const res = await fetch(url, { method, headers: body === undefined ? undefined : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const j = (await res.json().catch(() => null)) as { data?: T; error?: string } | null;
    return res.ok && j?.data !== undefined ? { ok: true, data: j.data } : { ok: false, error: j?.error ?? "Something went wrong, please retry" };
  } catch {
    return { ok: false, error: "Network error, please retry" };
  }
}

export function PayButton({ invoiceId, amountPaise }: { invoiceId: string; amountPaise: number }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [order, setOrder] = useState<Order | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);

  function poll(paymentId: string, attempt = 0) {
    timer.current = setTimeout(async () => {
      const r = await api<{ status: string; invoiceStatus: string }>(`/api/payments/${encodeURIComponent(paymentId)}/status`, "GET");
      if (r.ok && r.data.invoiceStatus === "PAID") {
        setPhase("paid");
        router.refresh();
      } else if (r.ok && r.data.status === "FAILED") {
        setPhase("failed");
      } else if (attempt + 1 >= POLL_MAX) {
        await api(`/api/payments/${encodeURIComponent(paymentId)}/refresh`, "POST");
        setPhase("slow");
      } else {
        poll(paymentId, attempt + 1);
      }
    }, POLL_MS);
  }

  async function confirm(o: Order, resp: CheckoutResponse) {
    setPhase("confirming");
    const v = await api(`/api/payments/verify`, "POST", { razorpayOrderId: resp.razorpay_order_id, razorpayPaymentId: resp.razorpay_payment_id, razorpaySignature: resp.razorpay_signature });
    if (!v.ok) {
      setError(v.error);
      setPhase("failed");
      return;
    }
    poll(o.paymentId);
  }

  async function start() {
    setError(null);
    setPhase("starting");
    const r = await api<Order>("/api/payments/order", "POST", { customerInvoiceId: invoiceId });
    if (!r.ok) {
      setError(r.error);
      setPhase("failed");
      return;
    }
    setOrder(r.data);
    if (r.data.gateway === "fake") {
      setPhase("checkout");
      return;
    }
    try {
      await loadCheckout();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the payment window");
      setPhase("failed");
      return;
    }
    const rz = new window.Razorpay!({
      key: r.data.keyId,
      order_id: r.data.razorpayOrderId,
      amount: r.data.amountPaise,
      currency: r.data.currency,
      name: "CementLink",
      retry: { enabled: false },
      handler: (resp: CheckoutResponse) => void confirm(r.data, resp),
      modal: { ondismiss: () => setPhase((p) => (p === "starting" || p === "checkout" ? "failed" : p)) },
    });
    rz.on("payment.failed", () => setPhase("failed"));
    setPhase("checkout");
    rz.open();
  }

  if (phase === "paid") return <p role="status" className="font-semibold text-success">Paid. Thank you.</p>;
  if (phase === "confirming") return <p role="status" className="text-sm">Confirming payment...</p>;
  if (phase === "slow") return (
    <div className="space-y-2">
      <p role="status" className="text-sm">Still confirming your payment. This can take a minute.</p>
      <Button type="button" onClick={() => router.refresh()}>Check again</Button>
    </div>
  );
  return (
    <div className="space-y-2">
      {phase === "checkout" && order?.gateway === "fake" ? (
        <div className="space-y-2 rounded-input border border-dashed border-border p-3" aria-label="Test payment window">
          <p className="text-sm font-semibold">Test gateway (no real money)</p>
          <p className="text-sm text-muted">Order <span data-testid="rzp-order-id">{order.razorpayOrderId}</span></p>
          <div className="flex gap-2">
            <Button type="button" onClick={() => void confirm(order, { razorpay_order_id: order.razorpayOrderId, razorpay_payment_id: `pay_fake_${order.paymentId.slice(-8).replace(/-/g, "")}`, razorpay_signature: "fake_checkout_signature" })}>Complete test payment</Button>
            <Button type="button" className="border border-border bg-transparent text-text" onClick={() => setPhase("failed")}>Cancel</Button>
          </div>
        </div>
      ) : (
        <Button type="button" disabled={phase === "starting" || phase === "checkout"} onClick={start}>
          {phase === "failed" ? "Retry payment" : `Pay ${formatPaise(amountPaise)}`}
        </Button>
      )}
      {phase === "failed" && <p role="alert" className="text-sm text-danger">{error ?? "Payment did not go through. You can retry."}</p>}
    </div>
  );
}
