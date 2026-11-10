import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE } from "@/lib/constants";

// Coarse gate only: no session cookie -> /login. Real checks happen in guards (DB-backed).
export function middleware(req: NextRequest) {
  if (!req.cookies.has(SESSION_COOKIE)) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/customer/:path*",
    "/distributor/:path*",
    "/provider/:path*",
    "/admin/:path*",
    "/pending",
  ],
};
