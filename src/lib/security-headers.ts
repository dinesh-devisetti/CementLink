export interface HeaderPair {
  key: string;
  value: string;
}

const RAZORPAY_SCRIPT = "https://checkout.razorpay.com";
const RAZORPAY_API = "https://api.razorpay.com";

/**
 * CSP. 'unsafe-inline' for scripts/styles is deliberate: Next.js App Router emits inline bootstrap
 * scripts, and a nonce would force every page to be dynamically rendered via middleware. All other
 * sources are pinned ('self' + Razorpay). 'unsafe-eval' is added only for the dev server (React refresh).
 */
export function buildCsp(isDev: boolean): string {
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline' ${RAZORPAY_SCRIPT}${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${RAZORPAY_API} https://lumberjack.razorpay.com ${RAZORPAY_SCRIPT}${isDev ? " ws:" : ""}`,
    `frame-src ${RAZORPAY_API} ${RAZORPAY_SCRIPT}`,
    `form-action 'self' ${RAZORPAY_API}`,
    "frame-ancestors 'none'",
    "base-uri 'self'",
    "object-src 'none'",
  ];
  return directives.join("; ");
}

export function securityHeaders(isDev: boolean, isProd: boolean): HeaderPair[] {
  const list: HeaderPair[] = [
    { key: "Content-Security-Policy", value: buildCsp(isDev) },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(self)" },
  ];
  if (isProd) list.push({ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" });
  return list;
}
