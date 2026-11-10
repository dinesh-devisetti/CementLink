import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { errorResponse } from "./guards";
import { AppError } from "../errors";

export function handleError(err: unknown): NextResponse {
  if (err instanceof AppError) {
    const res = errorResponse(err.httpStatus, err.code, err.message);
    if (err.retryAfterSec) res.headers.set("Retry-After", String(err.retryAfterSec));
    return res;
  }
  if (err instanceof ZodError) {
    const fields: Record<string, string> = {};
    for (const i of err.issues) fields[i.path.join(".") || "_"] ??= i.message;
    return NextResponse.json({ success: false, error: "Invalid input", code: "VALIDATION", fields }, { status: 400 });
  }
  console.error("Unhandled error", err);
  return errorResponse(500, "INTERNAL", "Something went wrong");
}

export const MAX_JSON_BYTES = 16 * 1024;

/** Parses a JSON body, refusing anything over ~16KB (declared Content-Length or actual text length) with 413. */
export async function readJson(req: Request, maxBytes: number = MAX_JSON_BYTES): Promise<unknown> {
  const tooLarge = () => new AppError("PAYLOAD_TOO_LARGE", "Request body is too large", 413);
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) throw tooLarge();
  const text = await req.text();
  if (text.length > maxBytes) throw tooLarge();
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("BAD_JSON", "Request body must be JSON", 400);
  }
}

/**
 * Client IP for rate limiting, or null when none can be trusted.
 * Only reads x-real-ip, and only when TRUST_PROXY=true (set by the platform proxy, e.g. Vercel).
 * x-forwarded-for is client-spoofable and is never used.
 */
export function clientIp(req: Request, trustProxy: boolean): string | null {
  if (!trustProxy) return null;
  const ip = req.headers.get("x-real-ip")?.trim();
  return ip && ip.length <= 64 ? ip : null;
}
