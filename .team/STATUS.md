# Team Status
App: CementLink        Updated: 2026-11-03
PM: done (.team/01-prd.md) | Design: done (.team/02-design.md) | Architecture: done (.team/03-architecture.md) | Plan: done
## Slices
| ID | Title | Stories | State | QA |
|----|-------|---------|-------|----|
| V1 | Scaffold + auth core: Next.js/TS/Tailwind/shadcn, zod config (rejects rzp_live_), Drizzle users/sessions/login_attempts, argon2 register/login/logout, DB sessions, login rate limit, requireRole guards + middleware, role-redirect stub dashboards, admin seed, lib/money + lib/qty, Vitest + Playwright config | S1 (part) | done | PASS (92 tests, 93% cov, e2e 3/3) |
| V2 | Admin approval + access gate: /pending, /admin approvals, approve/reject API (deletes sessions), cross-role 403/redirect, isolation tests, e2e register->pending->approve | S1 (rest) | done | PASS (122 tests, 94% cov, e2e 4/4 x8) |
| V3 | Customer split request: requests + request_lines, /customer/new split form (live remaining bags), tonnes->bags, past-date validation, /customer list + /customer/requests/[id], 360px e2e | S2 | done | PASS (180 tests, 94.9% cov, e2e 5/5 x2) |
| V4 | Distributor lines + demand total: scoped lines list, accept with price / reject, demand total bags + tonnes | S3 (part) | done | PASS (201 tests, 95.4% cov, e2e 6/6) |
| V5 | Purchase orders: /distributor/orders create PO to ACTIVE provider, server total, over-order warning; provider orders received, confirm/reject | S3 (rest), S4 (part) | done | PASS (235 tests, 95.1% cov, e2e 7/7) |
| V6 | Provider invoices: /provider/orders/[id] invoice form, qty cap (txn), unique invoice_no, provider totals per distributor, distributor read-only | S4 (rest) | todo | - |
| V7 | Razorpay test payments: payment request, payments + webhook_events, PaymentGateway (razorpay + fake), order create, Checkout.js, verify (AUTHORIZED only), signed idempotent webhook, polling, refresh, history, send-test-webhook script | S5 | todo | - |
| V8 | Admin analytics: per-distributor sales / qty requested / qty per provider, distributor + customer detail pages, reconciliation tests | S6 | todo | - |
| V9 | Transport planner: plans by city/pincode, capacity edit, ceil trips, save, admin view (cut first if short on time) | S7 (should) | todo | - |
## Decisions log (one line each)
- PM defaults: bags (20 bags = 1 t), INR paise, distributor sets price, one role per account, self-register + admin approval.
- Design: shadcn/ui + Tailwind assumed; customer mobile-first (bottom tabs), staff dashboards sidebar >=1024px with tables collapsing to cards on mobile.
- Stack: Next.js 15 + Drizzle/libSQL (SQLite local, Turso prod) + Vercel Hobby bom1; own argon2 + DB-session auth.
- Routes: page routes follow 02-design.md; API routes follow 03-architecture section 6.
- Payments: PAID only via signature-verified, idempotent webhook; app refuses rzp_live_ keys.
- Security-reviewer required on V1, V2, V7.
- Login rate limit: email key 5/15min, IP key separate LOGIN_IP_MAX_ATTEMPTS=50/15min (shared CGNAT/office IPs). Success never refunds ip: key (user-approved 2026-11-03).
- Approval: admin may revoke ACTIVE and re-approve REJECTED (API now, UI in V8); sessions deleted on reject only (user-approved 2026-11-03).
- Requests: POST /api/requests rate-limited REQUEST_MAX_PER_HOUR=10/customer; bodies >16KB -> 413; create via db.batch (local driver deadlocks interactive txns); ACTIVE-distributor race accepted, re-check at accept in V4.
- V4 deferred to next slice: accept/reject rate limit, per-line error UI, reject confirm, page cap, LOW cleanups (see 05 Review V4).
- V5 deferred to V6 start: flaky rate-limit test clock, PO form client bounds, total CHECK constraint, page cap on requests/admin-users, LOW cleanups (see 05 Review V5).
## Blockers
- .env.example unverified (lead + security denied read). User must confirm placeholders before commit and add REQUEST_MAX_PER_HOUR=10.
