import { NextResponse } from "next/server";
import { AppError } from "@/server/errors";
import { handleError } from "@/server/auth/http";
import { getDb } from "@/server/db/client";
import { handleRazorpayWebhook, MAX_WEBHOOK_BYTES } from "@/server/services/webhooks";

export const runtime = "nodejs";

/** Streams the body and stops as soon as it exceeds the byte cap (a lying or missing Content-Length cannot buffer more). */
async function readCapped(req: Request): Promise<string> {
  const tooLarge = () => new AppError("PAYLOAD_TOO_LARGE", "Request body is too large", 413);
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_WEBHOOK_BYTES) {
      await reader.cancel().catch(() => undefined);
      throw tooLarge();
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/** Server-to-server: no session or Origin check. Authenticity is the HMAC over the raw body, verified before anything is parsed or stored. */
export async function POST(req: Request): Promise<NextResponse> {
  try {
    const declared = Number(req.headers.get("content-length"));
    if (Number.isFinite(declared) && declared > MAX_WEBHOOK_BYTES) throw new AppError("PAYLOAD_TOO_LARGE", "Request body is too large", 413);
    const rawBody = await readCapped(req);
    const out = await handleRazorpayWebhook(getDb(), { rawBody, signature: req.headers.get("x-razorpay-signature"), eventId: req.headers.get("x-razorpay-event-id") });
    return NextResponse.json({ success: true, data: out });
  } catch (err) {
    return handleError(err);
  }
}
