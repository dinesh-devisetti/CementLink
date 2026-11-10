# ADR-001: CementLink MVP Architecture

## HANDOFF (read this first, <=12 lines)
Stack: Next.js 15 (App Router, TypeScript, Server Components and Route Handlers), Drizzle ORM on libSQL (local SQLite file in dev and tests, Turso free tier in prod), Zod, Tailwind + shadcn/ui, Vitest, Playwright.
Auth: our own email+password auth (argon2id), sessions stored in the DB behind an httpOnly cookie, one role per user (CUSTOMER/DISTRIBUTOR/PROVIDER/ADMIN), status PENDING/ACTIVE/REJECTED, `requireRole()` guard on every handler, every query scoped to the logged-in user.
Layout: `src/app` (role route groups + `/api`), `src/server/{db,auth,services,payments}`, `src/lib` (money, qty, zod schemas), `tests/{unit,integration,e2e}`, `scripts/`.
Data: users, sessions, login_attempts, requests -> request_lines (customer N:M distributor), purchase_orders (distributor N:M provider), invoices (PO 1:N), payments (line 1:N attempts, at most 1 PAID), webhook_events, transport_plans(+items).
Money: integer paise everywhere, computed only on the server. Qty: integer bags (1 t = 20 bags).
Payments: server creates the Razorpay order -> Checkout.js -> browser callback only shows "Confirming". PAID is set only by a signature-verified webhook. Idempotency: unique event id, conditional status update, unique razorpay ids.
API: REST JSON under `/api/*` (auth, requests, lines, pos, invoices, payments, webhooks/razorpay, admin, transport). Full list in section 6.
Hosting: Vercel Hobby (region bom1) + Turso (ap-south-1). Razorpay test keys only; the app refuses to boot with `rzp_live_` keys.
Tests: Vitest unit + integration against a temp SQLite file; Playwright headless Chromium with workers=1 against `next start` with a seeded e2e.db, FakeGateway, and signed webhook payloads.
Env: DATABASE_URL, DATABASE_AUTH_TOKEN, APP_URL, RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, RAZORPAY_WEBHOOK_SECRET, PAYMENT_GATEWAY, ADMIN_SEED_EMAIL, ADMIN_SEED_PASSWORD, SESSION_TTL_HOURS, LOGIN_MAX_ATTEMPTS, LOGIN_WINDOW_MINUTES.

---

## 1. Context
- One solo developer on a MacBook Air M1 with 8GB RAM. No Docker, no local LLMs. Free tiers only. Razorpay runs in test mode only.
- There are 4 roles. The distributor is the hub of the flow: it receives N:M demand from customers and places N:M supply orders with providers.
- Requirements that drive the design: strict per-user data isolation, payment state that only a verified webhook can move to Paid, integer paise, and lists under 2s for about 500 rows.

## 2. Stack decisions

| Decision | Choice | Why | Alternatives rejected |
|---|---|---|---|
| Framework | Next.js 15 App Router + TS, single deployable app | UI and API in one repo and one deploy; server components read through services directly | Separate Express API (two deploys, CORS); Remix (fewer hosting defaults) |
| DB | libSQL/SQLite: `file:./dev.db` locally, Turso free tier in prod | Same SQL dialect in every environment; no Docker; tests use temp files | Postgres on Supabase/Neon (needs Docker or network for local tests; Prisma can't switch sqlite<->pg cleanly) |
| ORM | Drizzle + drizzle-kit migrations | Light, typed, supports libSQL transactions, no heavy engine binary on an 8GB machine | Prisma (engine binary, slower cold starts on Vercel) |
| Validation | Zod schemas in `src/lib/validation`, shared by forms and handlers | One source of truth at every boundary | - |
| Auth | Our own: `@node-rs/argon2` (prebuilt for arm64 and Vercel) + DB sessions | Credentials-only auth with roles and approval states is about 150 lines; Auth.js credentials mode fights DB sessions | Auth.js, Clerk (external dependency, role sync), Supabase Auth (ties us to Supabase DB) |
| Styling | Tailwind + shadcn/ui, mobile-first | Fast; makes 360px layouts easy; matches the design spec | - |
| Payments | Razorpay REST (fetch) + Checkout.js, behind a `PaymentGateway` interface | Lets e2e tests swap in a fake; no SDK lock-in | `razorpay` npm SDK (fine, but it is only a thin wrapper) |
| Tests | Vitest + Playwright (Chromium only) | Fast, low memory use | Jest (slower with TS) |

## 3. Folder layout
```
src/
  app/
    (public)/login, register, pending/          # pending-approval page
    customer/ (dashboard, requests/new, requests/[id], payments)
    distributor/ (dashboard, lines, pos, pos/new, invoices, payment-requests, transport)
    provider/ (dashboard, pos, pos/[id]/invoice, invoices)
    admin/ (dashboard, approvals, distributors/[id], customers, customers/[id])
    api/...                                     # route handlers (section 6)
  middleware.ts                                 # coarse gate: no session cookie -> /login
  server/
    db/ client.ts, schema.ts                    # drizzle; migrations in /drizzle
    auth/ password.ts, session.ts, guards.ts, rate-limit.ts
    services/ users.ts, requests.ts, lines.ts, purchase-orders.ts,
              invoices.ts, payments.ts, analytics.ts, transport.ts
    payments/ gateway.ts (interface), razorpay.ts, fake.ts, signature.ts
    config.ts                                   # zod-parsed env; fails fast
  lib/ money.ts, qty.ts, dates.ts, validation/*.ts
  components/ (ui primitives, role-specific folders)
drizzle/                                        # SQL migrations
scripts/ seed.ts, reset-db.ts, send-test-webhook.ts
tests/ unit/, integration/, e2e/, fixtures/
```
Rules: handlers and pages are thin and call `services/*`. Services take an `actor` (`{id, role}`) as their first argument and scope every query to it. Files stay under 500 lines.

## 4. Role-based auth design
- **Register**: `POST /api/auth/register` with role in {CUSTOMER, DISTRIBUTOR, PROVIDER}. ADMIN can never be registered; it is created only by `scripts/seed.ts` from env. CUSTOMER gets `status=ACTIVE`. DISTRIBUTOR and PROVIDER get `status=PENDING`.
- **Login**: verify argon2id. Create a 32-byte random token, store `sha256(token)` in `sessions`, and set cookie `cl_session` (httpOnly, Secure, SameSite=Lax, Path=/, max-age=SESSION_TTL_HOURS). Rotate the token on login. Logout deletes the row.
- **Rate limit**: the `login_attempts` table keys on `email` and `ip`, with a fixed window (LOGIN_MAX_ATTEMPTS per LOGIN_WINDOW_MINUTES). Over the limit returns 429. It lives in the DB because there is no Redis, and that is fine at this scale.
- **Guards** (`server/auth/guards.ts`):
  - `getActor()` resolves the cookie to a user, or null.
  - `requireRole(...roles)` returns 401 with no session, 403 for the wrong role, and 403 `{code:"PENDING"}` when status is not ACTIVE.
  - Pages call `requireRolePage()`, which redirects to `/login`, `/pending`, or the user's own dashboard.
- **Defense in depth**:
  1. `middleware.ts` does only a cookie-presence redirect. It does not touch the DB, to stay edge-safe.
  2. Every route handler and server page calls the guard.
  3. Every service query includes an owner predicate (`customer_id = actor.id`, `distributor_id = actor.id`, `provider_id = actor.id`). If the row isn't found under that scope, return 404, not 403, so we don't leak that it exists.
  4. Integration tests assert cross-role and cross-tenant access is denied.
- **Approval**: `POST /api/admin/users/:id/approve|reject` updates status and deletes that user's sessions, so the change applies on next login.
- **CSRF**: SameSite=Lax cookie. Mutating handlers also check that `Origin` equals APP_URL. The webhook route is exempt and authenticated by HMAC instead.
- Customers only ever see `status=ACTIVE` distributors. Distributors only see ACTIVE providers.
- **Accepted trade-offs (V1 security review)**:
  - Duplicate-email register returns 409. That allows account enumeration, but it is accepted for a B2B directory because register is rate-limited per IP (`REGISTER_MAX_PER_HOUR`).
  - The login count is not reset on success, except that the per-email reservation is refunded. Resetting the IP key would let attackers clear their counter.
  - The per-email lockout DoS is a known MVP risk.
  - The client IP is trusted only when `TRUST_PROXY=true` (Vercel `x-real-ip`).
  - The fake gateway and `COOKIE_SECURE=false` are allowed in production only with `E2E=1` and never on Vercel. On other hosts, `E2E=1` is an explicit opt-in: never set it on a real deploy.
  - `TRUST_PROXY=true` is safe only behind a proxy that overwrites `x-real-ip` (Vercel does). With `TRUST_PROXY=false`, the IP login limit and the register limit are off.
  - Denied requests still count toward the email key, so a victim's lockout can be extended. This is accepted as the per-email lockout trade-off.
  - Fixed windows allow up to 2x max attempts in a burst across a window boundary. Accepted.

## 5. Data model (SQLite, Drizzle)
All ids are text UUIDv7, so they are sortable. Timestamps are integer epoch ms. Money columns end in `_paise` and are INTEGER. Quantities end in `_bags` and are INTEGER.

| Table | Key columns | Constraints / notes |
|---|---|---|
| users | id, email (unique, lowercased), password_hash, role, status, name, business_name, phone, city, created_at | role CHECK in 4 values; status CHECK PENDING/ACTIVE/REJECTED |
| sessions | id, user_id FK, token_hash unique, expires_at, created_at | index user_id |
| login_attempts | key (email or ip), window_start, count | PK(key, window_start) |
| requests | id, customer_id FK, total_bags, address, city, pincode, needed_by (date), created_at | total_bags > 0; pincode `^\d{6}$` |
| request_lines | id, request_id FK, distributor_id FK, qty_bags, price_per_bag_paise NULL, amount_paise NULL, status, accepted_at, payment_requested_at, paid_at | UNIQUE(request_id, distributor_id); status SENT/ACCEPTED/REJECTED/PAYMENT_PENDING/PAID; index (distributor_id, status) |
| purchase_orders | id, distributor_id FK, provider_id FK, qty_bags, rate_per_bag_paise, total_paise, status, created_at | status PLACED/CONFIRMED/REJECTED; total = qty*rate set by server; indexes on (provider_id), (distributor_id) |
| invoices | id, po_id FK, provider_id, distributor_id (denormalized for scoped reads), invoice_no, invoice_date, qty_bags, rate_per_bag_paise, amount_paise, created_at | UNIQUE(provider_id, invoice_no); SUM(qty_bags) per PO <= po.qty_bags, checked in a transaction; PO must be CONFIRMED |
| payments | id, request_line_id FK, customer_id, distributor_id, amount_paise, currency='INR', status, razorpay_order_id UNIQUE, razorpay_payment_id UNIQUE NULL, failure_reason, created_at, paid_at | status CREATED/AUTHORIZED/PAID/FAILED; a partial unique index on (request_line_id) WHERE status='PAID' guarantees at most one PAID per line |
| webhook_events | id, provider_event_id UNIQUE, event_type, razorpay_order_id, payload_sha256, received_at, processed_at, result | dedupe ledger and audit |
| transport_plans | id, distributor_id, plan_date, capacity_bags, total_bags, total_trips, truck_count, created_at | capacity_bags = tonnes*20 (default 200) |
| transport_plan_items | id, plan_id FK, city, pincode, bags, trips | trips = ceil(bags / capacity_bags) using integer math |

**How the mappings work**
- **Customer to distributor (1:1, 1:N, N:1)**: one `requests` row can have N `request_lines`, one per distributor. A distributor receives lines from many customers. N:M overall, with `request_lines` as the join table. Its unique constraint stops duplicate distributors within one request.
- **Distributor to provider (1:1, 1:N, N:1)**: `purchase_orders` is the N:M join. A distributor can place POs with many providers, and a provider can receive POs from many distributors. POs are deliberately not linked to request lines (the PRD lets a distributor stock ahead). Unfulfilled demand = Σ accepted/pending/paid line bags − Σ non-rejected PO bags. Over-ordering shows a warning and is still allowed.
- **PO to invoices**: 1:N, so partial supply works, capped at the PO qty.
- **Line to payments**: 1:N attempts (retries after a failure). At most one can be PAID.

**Line state machine** (enforced in `services/lines.ts` with conditional UPDATEs):
- SENT → ACCEPTED (sets price; amount_paise = qty_bags × price_per_bag_paise) or REJECTED
- ACCEPTED → PAYMENT_PENDING (distributor sends the payment request; amount is frozen)
- PAYMENT_PENDING → PAID (webhook only)
- A failed or cancelled payment leaves the line at PAYMENT_PENDING.

**Money and quantity** (`src/lib/money.ts`, `qty.ts`, fully unit-tested):
- Rupee input such as "385.50" is parsed as a string into paise with a regex `^\d{1,7}(\.\d{1,2})?$`. No floats.
- Display uses `Intl.NumberFormat('en-IN', {style:'currency', currency:'INR'})`.
- Tonnes input must convert to a whole number of bags (multiples of 0.05 t).
- Every total is computed on the server. Totals sent by the client are ignored.

## 6. API surface (JSON; errors `{success:false, error, code}`; lists paginated `?page&limit<=50`)
| Method | Path | Role |
|---|---|---|
| POST | /api/auth/register, /api/auth/login, /api/auth/logout | public / any |
| GET | /api/me | any |
| GET | /api/distributors (ACTIVE only) | CUSTOMER |
| POST/GET | /api/requests, GET /api/requests/:id | CUSTOMER (own) |
| GET | /api/lines?status= (+ demand summary) | DISTRIBUTOR (own) |
| POST | /api/lines/:id/accept {pricePerBag}, /reject, /payment-request | DISTRIBUTOR (own) |
| GET | /api/providers (ACTIVE only) | DISTRIBUTOR |
| POST/GET | /api/pos | DISTRIBUTOR (create/own), PROVIDER (received) |
| POST | /api/pos/:id/confirm, /api/pos/:id/reject | PROVIDER (own) |
| POST | /api/pos/:id/invoices | PROVIDER (own, CONFIRMED) |
| GET | /api/invoices | PROVIDER (own), DISTRIBUTOR (own, read-only) |
| POST | /api/payments/order {lineId} | CUSTOMER (own line, PAYMENT_PENDING) |
| POST | /api/payments/verify | CUSTOMER (UX only; never sets PAID) |
| GET | /api/payments, /api/payments/:id/status | CUSTOMER (own) |
| POST | /api/payments/:id/refresh (fetch order status from Razorpay; same idempotent apply path) | CUSTOMER (own) |
| POST | /api/webhooks/razorpay | HMAC only |
| GET/POST | /api/transport/plans, GET /api/transport/preview?capacityTonnes= | DISTRIBUTOR (own); ADMIN read |
| GET | /api/admin/users?status=PENDING, POST /api/admin/users/:id/approve, /reject | ADMIN |
| GET | /api/admin/analytics/distributors, /api/admin/distributors/:id, /api/admin/customers, /api/admin/customers/:id | ADMIN |

Server pages read through the same services directly rather than calling their own API over HTTP. Analytics are SQL aggregates (`SUM`/`GROUP BY`) over indexed columns.

## 7. Razorpay test-mode flow
1. **Payment request**: the distributor calls `/payment-request`. The line moves to PAYMENT_PENDING with `amount_paise` frozen.
2. **Create order**: the customer clicks Pay and the client calls `POST /api/payments/order {lineId}`. The server:
   - checks ownership and that the line is PAYMENT_PENDING;
   - reuses an existing `payments` row in CREATED status for that line if the amount matches, so double-clicks don't create duplicate orders;
   - otherwise calls Razorpay `POST /v1/orders` with Basic auth (key_id:key_secret) and body `{amount: amount_paise, currency:"INR", receipt: payment.id, notes:{lineId, paymentId}}`;
   - stores the `razorpay_order_id` and returns `{orderId, keyId, amount, currency}`.
3. **Checkout**: the client loads `https://checkout.razorpay.com/v1/checkout.js` (allowed in CSP) and opens it with `order_id`. No card or UPI data ever touches our servers.
4. **Browser callback**: the success handler posts `{razorpay_order_id, razorpay_payment_id, razorpay_signature}` to `/api/payments/verify`. The server checks `HMAC_SHA256(order_id + "|" + payment_id, KEY_SECRET)` with `timingSafeEqual`. If it matches, the payment can move to AUTHORIZED and the payment id is saved. The UI shows "Confirming payment..." and polls `/status`. **The line is not marked Paid here.** Dismissal or failure leaves the status at "Payment pending" and the user can retry.
5. **Webhook** `POST /api/webhooks/razorpay` (Node runtime, `await req.text()` for the raw body):
   - Verify `X-Razorpay-Signature` = `HMAC_SHA256(rawBody, WEBHOOK_SECRET)` with a timing-safe compare. A mismatch returns 400 and nothing is written.
   - In one transaction:
     - INSERT into `webhook_events` using `provider_event_id` from the `x-razorpay-event-id` header. On a unique conflict, return 200 `{duplicate:true}` with no changes.
     - **`payment.captured` / `order.paid`**: load the payment by `razorpay_order_id`. Require entity amount == `amount_paise` and currency INR, otherwise record `result=amount_mismatch` and don't change state. Run `UPDATE payments SET status='PAID', razorpay_payment_id=?, paid_at=? WHERE id=? AND status<>'PAID'`. Only if one row changed, run `UPDATE request_lines SET status='PAID', paid_at=? WHERE id=? AND status='PAYMENT_PENDING'`.
     - **`payment.failed`**: set the payment to FAILED only if it isn't PAID. The line stays PAYMENT_PENDING.
     - Set `processed_at`, then return 200 quickly.
   - Idempotency rests on three layers: the event-id ledger, the conditional updates, and unique `razorpay_order_id`/`razorpay_payment_id`. Duplicate or out-of-order deliveries cannot double-apply.
6. **Setup**: in the Razorpay test dashboard, turn on auto-capture. Subscribe the webhook to `payment.captured`, `payment.failed` and `order.paid`.
7. **Local dev**: webhooks can't reach localhost. Two options: `cloudflared tunnel --url http://localhost:3000` (free, no account), or `scripts/send-test-webhook.ts <orderId>`, which signs a realistic payload with the local webhook secret. The `/refresh` endpoint (Razorpay `GET /v1/orders/:id/payments`) is a reconciliation fallback that goes through the same idempotent apply function.
8. **Safety**: `config.ts` throws at boot if `RAZORPAY_KEY_ID` starts with `rzp_live_`. Secrets are only read on the server; the key id goes to the client in the order response. Nothing from the webhook payload beyond ids, amount, status and event type is persisted, apart from its sha256 hash.

## 8. Testing approach
- **Unit (Vitest)**: money parse/format, tonnes-to-bags conversion, trips calculation, allocation-sum validation, zod schemas, both HMAC verifiers (with known vectors), line and PO state transitions, guard decisions.
- **Integration (Vitest)**: each test file gets a temp `file:` SQLite DB with migrations applied. Tests call services and route handlers directly with fake actors. They cover:
  - cross-tenant isolation (distributor A can't read B's lines; provider can't read another provider's POs)
  - pending users blocked; admin-only routes
  - invoice qty cap
  - webhook: valid, bad signature, duplicate event, amount mismatch, failed-then-captured
  - analytics reconciling against fixture data
- **E2E (Playwright)**: `playwright.config.ts` uses `workers: 1`, `fullyParallel: false`, `projects: [chromium]`, `headless: true`. `webServer` runs `npm run build && npm start` on port 3100 with `DATABASE_URL=file:./tests/e2e.db PAYMENT_GATEWAY=fake`. `globalSetup` resets and seeds the DB. Flows:
  - S1 register, pending, admin approval
  - S2 split request
  - S3 accept + PO
  - S4 invoice
  - S5 pay: FakeGateway returns a fake order id and the test POSTs a correctly signed webhook (built with the test secret), then asserts Paid; a duplicate post leaves state unchanged; a failure path leaves Payment pending
  - S6 admin numbers
  - S7 planner recalculation
  - one test at 360px viewport for customer pages
- `FakeGateway` is only allowed when `NODE_ENV!=='production'`; `config.ts` enforces this. An optional `@razorpay-live-test` tagged spec uses real test keys and runs manually, never in CI.
- Coverage target is 80% (Vitest v8 coverage) on `src/server` and `src/lib`. Scripts: `test`, `test:coverage`, `e2e`, `lint`, `typecheck`.
- Memory: Vitest pool `threads` with `maxThreads: 2`, to stay comfortable on 8GB.

## 9. Environment variables (`.env.example` committed; `.env` git-ignored)
| Var | Example / default | Notes |
|---|---|---|
| DATABASE_URL | `file:./dev.db` / `libsql://<db>.turso.io` | required |
| DATABASE_AUTH_TOKEN | (empty locally) | required for Turso |
| APP_URL | `http://localhost:3000` | Origin check, redirects |
| RAZORPAY_KEY_ID | `rzp_test_...` | must start with `rzp_test_` |
| RAZORPAY_KEY_SECRET | - | server only |
| RAZORPAY_WEBHOOK_SECRET | - | server only, set in dashboard |
| PAYMENT_GATEWAY | `razorpay` \| `fake` | `fake` rejected in production |
| ADMIN_SEED_EMAIL / ADMIN_SEED_PASSWORD | - | used only by `scripts/seed.ts` |
| SESSION_TTL_HOURS | `168` | |
| LOGIN_MAX_ATTEMPTS / LOGIN_WINDOW_MINUTES | `5` / `15` | |

All of these are parsed with Zod in `src/server/config.ts` at startup, so a missing or invalid value fails fast.

## 10. Hosting and operations
- **Vercel Hobby** with the function region set to `bom1`, plus **Turso free** in `aws-ap-south-1`. Migrations run via `drizzle-kit migrate` from the laptop against Turso, as a manual step.
- **Caveat**: Vercel Hobby terms are for non-commercial use, which is fine for a test-mode MVP. Move to Pro or Render before taking live payments.
- **Backups**: Turso point-in-time restore on the free plan, plus a manual `turso db shell .dump` before each migration.
- **Monitoring**: Vercel logs. The `webhook_events.result` column doubles as a payment audit trail.
- **Rollback**: redeploy the previous Vercel build. Migrations are additive-only during the MVP.
- Per CLAUDE.md, nothing gets deployed and no cloud resources are created without the user's explicit yes.

## 11. Consequences
- **Positive**:
  - one deployable app
  - identical SQL in dev, test and prod
  - no Docker
  - payments can't be marked Paid by the browser
  - isolation enforced in the service layer and covered by tests
- **Negative**:
  - SQLite/Turso has a single writer, which is fine at MVP scale
  - our own auth needs careful review (security-reviewer agent before the S1 merge)
  - no realtime updates; the payment status page polls
  - webhooks need a tunnel or the signing script when developing locally
- **Revisit when**: there are more than about 10k users, live payments, or multi-role accounts. At that point consider Postgres (Neon) and Auth.js or Clerk.

**Status**: Proposed · **Date**: 2026-11-03
