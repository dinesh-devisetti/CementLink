"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { sendJson } from "@/lib/client-api";

/**
 * Opens a REQUESTED order with one client-side POST on mount (never in a GET or server render, so link prefetch
 * cannot open orders). The server call is idempotent; on success the page refreshes to show the drafts.
 */
export function OpenOrderOnMount({ orderId }: { orderId: string }) {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void sendJson(`/api/orders/${orderId}/open`, "POST").then((r) => {
      if (r.ok) router.refresh();
      else setError(r.error);
    });
  }, [orderId, router]);

  return error ? (
    <p role="alert" className="text-sm text-danger">{error}</p>
  ) : (
    <p role="status" className="text-sm text-muted">Opening order...</p>
  );
}
