# ADR-001 (rev 2): CementLink MVP Architecture for PRD v2

## HANDOFF (read this first, <=12 lines)
Stack unchanged: Next.js 15 App Router + TS, Drizzle on libSQL (SQLite file locally/tests, Turso prod), Zod, Tailwind/shadcn, Vitest, Playwright, Vercel Hobby bom1, own argon2id + DB sessions, Razorpay test mode (webhook-only PAID, rzp_live_ refused).
Units: qty is INTEGER kg (`*_kg`), input in tonnes with up to 3 decimals; money is INTEGER paise; rate is per tonne (`rate_per_tonne_paise`); amount = (kg*rate+500)/1000 in SQL, mirrored in lib/money.
New tables: links, orders, order_allocations, purchase_orders (DRAFT..PAID, provider nullable in DRAFT), po_items (PO x source order), dispatches, provider_invoices, provider_payments, customer_invoices, payments, webhook_events, plus a guard_assert view.
Kept: users, sessions, login_attempts, server/auth/*, config, errors, http, rate limits, page caps, IST dates. Dropped: requests, request_lines, v1 purchase_orders, v1 invoices (forward migration 0005 drops them).
Writes: no interactive transactions (local driver deadlock). Single-statement transitions use a conditional UPDATE or INSERT...SELECT (the V6 createInvoice pattern). Multi-statement transitions use a guarded db.batch: the first statement is a guard_assert, then the writes, then post-condition asserts. Any failed assert rolls back the whole batch, and diagnose() maps it to an AppError.
Drafts: opening an order (REQUESTED->UNDER_REVIEW) creates its drafts in the same batch, exactly once (status guard + UNIQUE seed_key). Draft edits use purchase_orders.version for optimistic concurrency (409 STALE).
Combine: same distributor, same non-null provider, all DRAFT, >=2 POs. Result is one item per source order (same-order items are merged). Split-back works while DRAFT.
Order status is stored, and the transition that causes each rollup also writes it, in the same batch (rollup rules in section 6).
Provider never sees DRAFT POs. Customer sees only its own items and no provider prices. Link gating applies to new orders and placing POs only; existing documents stay actionable.
API: REST under /api (section 8). Services in src/server/services/<domain>.ts take an actor and scope every query to it. Pure planners live in src/server/domain.
Next: planner re-slices; designer's 02-design.md v2 owns page routes and labels.

---

## 1. Context (delta from rev 1)
- Constraints are unchanged: solo developer, 8GB M1, no Docker, free tiers, Razorpay test mode only.
- PRD v2 changes the model to: Customer -> ONE linked distributor -> order split by provider -> auto-drafted POs (combinable across orders) -> provider accept/dispatch/invoice -> distributor delivers -> customer invoice -> Razorpay -> manual provider payments.
- Drivers: per-user isolation; webhook-only PAID; integer kg and paise; correctness under concurrent clicks without interactive transactions; lists under 2s at about 500 rows.

## 2. Stack decisions
Every rev-1 decision still holds: the table in rev 1 section 2 is unchanged, and v2 forces no stack change. One clarification is added.

| Decision | Choice | Why |
|---|---|---|
| Multi-statement atomicity | `db.batch([...])` (one libSQL transaction) + `guard_assert` view whose INSTEAD OF trigger RAISEs ABORT | Interactive txns deadlock the local sync driver across awaits (decided in V3); batch is atomic and never awaits while holding the write lock |

## 3. Folder layout
```
src/
  app/
    (public)/login, register, pending
    customer/ distributor/ provider/ admin/     # page routes per 02-design.md v2
    api/...                                     # section 8
  middleware.ts                                 # cookie-presence gate (unchanged)
  server/
    db/ client.ts, schema.ts, guard.ts (guardedBatch, assertSql, isAssertFailure),
        fragments.ts (activeUser, activeLink, liveItem, istDate SQL)
    auth/ (unchanged) password, session, cookie, guards, with-auth, origin, decide, rate-limit, action-limit, http
    domain/ order-status.ts, combine-plan.ts, split-plan.ts, amounts.ts   # pure, unit-tested, no DB
    services/ users.ts, admin-users.ts (kept)
              links.ts, directory.ts, orders.ts, drafts.ts (edit/split/combine/split-back),
              po-lifecycle.ts (place/accept/reject/dispatch), provider-invoices.ts,
              provider-payments.ts, customer-invoices.ts, payments.ts, webhooks.ts,
              balances.ts, analytics.ts
    payments/ gateway.ts, razorpay.ts, fake.ts, signature.ts
    config.ts, errors.ts
  lib/ money.ts, qty.ts (kg/tonnes), dates.ts (IST), constants.ts, validation/*.ts
  components/
drizzle/ 0000-0004 (v1, kept as history), 0005_v2 (drop v1 trade tables, create v2), 0006_guard_assert (custom SQL)
scripts/ env.ts, migrate.ts, seed.ts (v2 demo: Ramu/Giri/Anjani/Ambuja + active links), reset-db.ts, send-test-webhook.ts
tests/ unit/, integration/, e2e/, fixtures/
```
Rules (unchanged):
- Handlers and pages stay thin.
- Services take `actor {id, role}` first.
- Out-of-scope rows return 404.
- Files stay under 500 lines.
- No mutation: services build new objects.

## 4. Units, money, dates
- **Qty** (`lib/qty.ts`, rewritten):
  - `tonnesToKg(str)` accepts regex `^\d{1,4}(\.\d{1,3})?$` and requires >0.
  - The order cap is `MAX_ORDER_KG = 1_000_000` (1000 t).
  - `kgToTonnes(kg)` returns "10.5", with trailing zeros trimmed. `formatTonnes(kg)` returns "10.5 t".
  - The bags helpers and `tripsFor` are removed (the transport planner moved to Later).
- **Rate**: `rate_per_tonne_paise` is INTEGER, with 1 <= rate <= `MAX_RATE_PER_TONNE_PAISE = 10_000_000` (Rs 1,00,000/t). It replaces MAX_PRICE_PAISE in constants.ts.
- **Amount**:
  - `amount_paise = (qty_kg * rate_per_tonne_paise + 500) / 1000` (SQLite integer division, round half up).
  - The same formula is in `domain/amounts.ts`. It is enforced by a CHECK on every amount column.
  - Max product is 1e6 * 1e7 = 1e13, which is within int64 and JS safe integers.
- **Money input/display**: `lib/money.ts` is unchanged (string rupees -> paise, `en-IN` INR format).
- **Dates**:
  - Business dates are `YYYY-MM-DD` in IST.
  - `lib/dates.ts`: `todayIst()`, `istDate(ms)`.
  - In SQL: `date(ms/1000 + 19800, 'unixepoch')`.
  - Timestamps are epoch-ms INTEGER.
  - ids are text UUIDs as today. Display numbers are `PO-`/`ORD-` plus the first 8 hex characters.

## 5. Data model (SQLite, Drizzle)
Legend: FK = references users/rows. Every table has `created_at`; mutable tables have `updated_at`.

| Table | Key columns | Constraints / notes |
|---|---|---|
| users, sessions, login_attempts | unchanged | kept as-is |
| links | id, kind, upper_id FK, lower_id FK, status, requested_by FK, decided_at, revoked_by NULL | kind CHECK IN ('PROVIDER_DISTRIBUTOR','DISTRIBUTOR_CUSTOMER'); upper = provider or distributor, lower = distributor or customer; status CHECK IN ('PENDING','ACTIVE','REJECTED','REVOKED'); UNIQUE(upper_id, lower_id); CHECK upper_id <> lower_id; idx (upper_id,status), (lower_id,status) |
| orders | id, customer_id FK, distributor_id FK, qty_kg, address, city, pincode, needed_by, status, reject_reason NULL, opened_at, delivered_at, cancelled_at | qty_kg CHECK 1..1000000; pincode CHECK 6 digits; status CHECK IN ('REQUESTED','UNDER_REVIEW','POS_PLACED','DISPATCHED','DELIVERED','INVOICED','PAID','REJECTED','CANCELLED'); idx (customer_id,created_at), (distributor_id,status,created_at) |
| order_allocations | id, order_id FK cascade, provider_id FK, qty_kg | the customer's split, immutable after insert; UNIQUE(order_id, provider_id); qty_kg > 0; distributor's choice = orders.qty_kg - SUM(alloc), computed, never stored |
| purchase_orders | id, distributor_id FK, provider_id FK NULL, status, version, qty_kg NULL, rate_per_tonne_paise NULL, total_paise NULL, reject_reason NULL, placed_at, decided_at | status CHECK IN ('DRAFT','PLACED','ACCEPTED','REJECTED','DISPATCHED','INVOICED','PAID'); CHECK (status='DRAFT' OR (provider_id IS NOT NULL AND qty_kg IS NOT NULL)); qty_kg frozen at PLACE = SUM(items); CHECK total_paise IS (CASE WHEN rate IS NULL THEN NULL ELSE (qty_kg*rate+500)/1000 END) once placed; idx (distributor_id,status,created_at), (provider_id,status,created_at) |
| po_items | id, po_id FK, order_id FK, distributor_id (denorm), qty_kg, seed_key NULL, source_item_id NULL | qty_kg > 0; UNIQUE(po_id, order_id) (one item per source order); UNIQUE(seed_key) (auto-draft idempotency, `<orderId>:<providerId>` or `<orderId>:choice`); idx (order_id); items are mutable only while the parent PO is DRAFT |
| dispatches | id, po_id FK UNIQUE, provider_id, distributor_id (denorm), dispatch_date, vehicle_no NULL, driver_phone NULL | one per PO (whole-PO dispatch); vehicle_no normalized upper-case `^[A-Z0-9]{4,12}$`; driver_phone `^[6-9]\d{9}$`; idx (distributor_id,dispatch_date), (dispatch_date) for admin |
| provider_invoices | id, po_id FK, provider_id, distributor_id (denorm), invoice_no, invoice_date, qty_kg, rate_per_tonne_paise, amount_paise, status, paid_at | UNIQUE(provider_id, invoice_no); amount CHECK formula; status CHECK IN ('UNPAID','PAID'); SUM(qty_kg) per PO <= po.qty_kg (guarded insert); idx (po_id), (provider_id,created_at), (distributor_id,created_at) |
| provider_payments | id, provider_invoice_id FK, provider_id, distributor_id (denorm), amount_paise, paid_on, mode, reference NULL, created_by FK | amount > 0; mode CHECK IN ('CASH','UPI','NEFT','RTGS','IMPS','CHEQUE','OTHER'); immutable (no update/delete API); SUM per invoice <= invoice amount (guarded insert); idx (provider_invoice_id), (provider_id,distributor_id,paid_on), (distributor_id,paid_on) |
| customer_invoices | id, order_id FK UNIQUE, distributor_id, customer_id, invoice_no, invoice_date, qty_kg, rate_per_tonne_paise, amount_paise, status, payment_requested_at, paid_at | UNIQUE(distributor_id, invoice_no); qty_kg = order qty (set by server); status CHECK IN ('ISSUED','PAYMENT_REQUESTED','PAID'); idx (customer_id,created_at), (distributor_id,status) |
| payments | id, customer_invoice_id FK, customer_id, distributor_id, amount_paise, currency='INR', status, razorpay_order_id UNIQUE NULL, razorpay_payment_id UNIQUE NULL, failure_reason, paid_at | status CHECK IN ('CREATED','AUTHORIZED','PAID','FAILED'); partial UNIQUE(customer_invoice_id) WHERE status='PAID'; partial UNIQUE(customer_invoice_id) WHERE status='CREATED' (one in-flight attempt, double-click safe) |
| webhook_events | id, provider_event_id UNIQUE, event_type, razorpay_order_id, payload_sha256, received_at, processed_at, result | unchanged from rev 1 |
| guard_assert (VIEW) | `CREATE VIEW guard_assert AS SELECT 1 AS ok` + `CREATE TRIGGER guard_assert_ins INSTEAD OF INSERT ON guard_assert WHEN NEW.ok IS NOT 1 BEGIN SELECT RAISE(ABORT, 'ASSERT_FAILED'); END` | stores nothing; custom migration 0006 |

**Relationships**
- Customer to distributor: N:M via `links` (DISTRIBUTOR_CUSTOMER). An order targets exactly one distributor.
- Distributor to provider: N:M via `links` (PROVIDER_DISTRIBUTOR).
- Order to PO: N:M via `po_items`. One order spans several provider POs; one combined PO spans several orders.
- PO to provider invoices: 1:N, capped by qty.
- Provider invoice to provider payments: 1:N, capped by amount.
- Order to customer invoice: 1:1.
- Customer invoice to payments: 1:N attempts, at most 1 PAID.

**Derived terms (`server/db/fragments.ts`)**
- `liveItem`: a po_items row whose PO status <> 'REJECTED'.
- `activeLink(upper, lower)`: link ACTIVE AND both users ACTIVE.
- Order coverage = SUM(live items qty_kg). It must equal orders.qty_kg to place.

**Visibility rules (service-layer predicates, covered by integration tests)**
- **Customer**:
  - own orders, allocations and customer invoices/payments;
  - for POs, only its own items: provider name, item qty, PO status, dispatch date and vehicle;
  - never PO rates, other customers' items, or provider invoices.
- **Distributor**: everything where `distributor_id = actor`, including drafts. Provider invoices are read-only.
- **Provider**:
  - POs where `provider_id = actor AND status <> 'DRAFT'`;
  - their items with the source order's delivery address (address, city, pincode, needed_by) and the customer's display name only, no email or phone;
  - own invoices and receipts;
  - the Distributors tab shows only distributors with an ACTIVE or REVOKED link and their documents.
- **Admin**: read-all for analytics; writes only approvals and forced links.

## 6. State machines and where each transition is enforced
Enforcement types:
- **C** = single conditional UPDATE or INSERT...SELECT (all preconditions are in the WHERE; rowsAffected 0 -> `diagnose()` re-reads and throws a precise AppError, exactly like V6 `createInvoice`).
- **G** = guarded batch: `[guard_assert(pre) , writes... , guard_assert(post)...]` in one `db.batch`.

### 6.1 Guarded batch contract (`server/db/guard.ts`)
1. Read the immutable or optimistically versioned inputs (allocations, frozen PO items, draft versions) before the batch. Compute the plan with a pure domain function.
2. The batch's first statement is `INSERT INTO guard_assert(ok) VALUES ((<precondition subqueries>))`. Use VALUES with scalar subqueries, never `SELECT ... WHERE`: an empty select would silently pass. Because this statement is a write, the transaction takes the write lock before any read, so there is no read-then-upgrade BUSY.
3. Then the writes. Rollup UPDATEs are self-guarded (`WHERE status = <from> AND NOT EXISTS(...)`), so they are idempotent.
4. Then the post-condition asserts, for invariants such as sums and coverage.
5. On error `ASSERT_FAILED` (`isAssertFailure(e)` walks `.cause` like `isUniqueViolation`), the batch has fully rolled back. `diagnose()` reads current state and throws NOT_FOUND / FORBIDDEN / INVALID_STATE / STALE / NOT_LINKED / QTY_MISMATCH and similar codes. Unique violations map to 409 codes. SQLITE_BUSY after the 5s busy timeout maps to 503 `RETRY`.

### 6.2 Link
`PENDING -> ACTIVE | REJECTED`, `ACTIVE -> REVOKED`, `REJECTED|REVOKED -> PENDING` (re-request).

| Transition | Actor | Enforcement |
|---|---|---|
| request | lower tier (DISTRIBUTOR->PROVIDER, CUSTOMER->DISTRIBUTOR) | C: `INSERT...SELECT` where target has the right role and status ACTIVE and requester is ACTIVE; `ON CONFLICT(upper_id,lower_id) DO UPDATE SET status='PENDING' WHERE status IN ('REJECTED','REVOKED')`; rate-limited `act:link` |
| approve / reject | upper tier | C: `WHERE id AND upper_id=actor AND status='PENDING'` |
| revoke | either side | C: `WHERE id AND actor IN (upper_id,lower_id) AND status='ACTIVE'`, sets revoked_by |
| force active | ADMIN | C: upsert ACTIVE (both users must be ACTIVE and of the right roles) |

Revoke blocks new orders, new allocations and PO placement. It does not block accept, dispatch, invoicing, payments or reads of existing documents.

### 6.3 Order
`REQUESTED -> UNDER_REVIEW -> POS_PLACED -> DISPATCHED -> DELIVERED -> INVOICED -> PAID`. Side exits: `REQUESTED -> CANCELLED` (customer) and `REQUESTED|UNDER_REVIEW -> REJECTED` (distributor). Also `POS_PLACED -> UNDER_REVIEW` when a provider rejects.

| Transition | Actor | Enforcement |
|---|---|---|
| create (REQUESTED) | CUSTOMER | G: pre = `activeLink(distributor, customer)` AND every allocated provider `activeLink(provider, distributor)` AND count matches; writes = order + allocations; post = SUM(alloc) <= qty. Zod already checks sum <= total, unique providers, qty > 0, needed_by >= todayIst. Rate limit REQUEST_MAX_PER_HOUR (name kept) + 16KB body cap |
| cancel | CUSTOMER | C: `WHERE id AND customer_id=actor AND status='REQUESTED'` (races with open: exactly one wins) |
| open -> UNDER_REVIEW + auto drafts | DISTRIBUTOR | G (see 6.5): pre = own order, status REQUESTED, distributor ACTIVE; writes = status/opened_at + drafts. If the order is already opened, return the existing drafts (idempotent no-op) |
| reject {reason} | DISTRIBUTOR | G: pre = own, status IN (REQUESTED, UNDER_REVIEW), no live item in a non-DRAFT PO; writes = delete this order's items in DRAFT POs, delete now-empty own DRAFT POs, set REJECTED |
| -> POS_PLACED | system (in place batch) | self-guarded UPDATE `WHERE status='UNDER_REVIEW' AND NOT EXISTS(live item of this order in a DRAFT PO)` |
| -> DISPATCHED | system (in dispatch batch) | `WHERE status='POS_PLACED' AND NOT EXISTS(live item whose PO status IN ('DRAFT','PLACED','ACCEPTED'))` |
| -> DELIVERED | DISTRIBUTOR | C: `WHERE own AND status='DISPATCHED'`, sets delivered_at |
| -> INVOICED | system (in customer-invoice batch) | `WHERE status='DELIVERED'` |
| -> PAID | webhook only | `WHERE status='INVOICED'` in the webhook batch |
| POS_PLACED -> UNDER_REVIEW | system (in provider-reject batch) | `WHERE status='POS_PLACED'` (new drafts now exist) |

The rollup rules live in one pure function, `domain/order-status.ts`. It is unit-tested and serves as the spec for the SQL fragments. An integration test asserts the stored status equals the recomputed status after every flow.

### 6.4 Purchase order
`DRAFT -> PLACED -> ACCEPTED -> DISPATCHED -> INVOICED -> PAID`, plus `PLACED -> REJECTED` (terminal; its items are copied to new drafts).

| Transition | Actor | Enforcement |
|---|---|---|
| draft edits (6.5) | DISTRIBUTOR | C or G with `version` check; every edit bumps `version` |
| place (selected, max 20) | DISTRIBUTOR | G: pre = all own, all DRAFT, versions match, provider NOT NULL, `activeLink(provider, distributor)` for each, distributor ACTIVE, and every touched order is UNDER_REVIEW with coverage = qty_kg; writes = `status='PLACED', placed_at, qty_kg=(SUM items), total_paise=formula when rate set`, then order rollup -> POS_PLACED |
| accept | PROVIDER | C: `WHERE own AND status='PLACED' AND provider ACTIVE` |
| reject {reason} | PROVIDER | G: pre = own, PLACED, provider ACTIVE; writes = PO REJECTED + reason; for each frozen item (read before the batch, immutable), insert a new DRAFT PO with provider NULL and a copied item (`source_item_id`), one per source order; order rollup POS_PLACED -> UNDER_REVIEW |
| dispatch {dispatchDate, vehicleNo?, driverPhone?} | PROVIDER | G: pre = own, ACCEPTED, provider ACTIVE, placed date (IST) <= dispatchDate <= todayIst; writes = INSERT dispatches (UNIQUE po_id), PO DISPATCHED, order rollup -> DISPATCHED |
| -> INVOICED | system (in invoice batch) | `WHERE status='DISPATCHED' AND (SUM invoice qty) = qty_kg` |
| -> PAID | system (in provider-payment batch) | `WHERE status='INVOICED' AND NOT EXISTS(provider_invoices of PO with status='UNPAID')` |

### 6.5 Drafts: idempotent creation, edit, split, combine
- **Auto-draft on open (S4, must-pass cases)**:
  - Allocations are immutable, so `openOrder` reads them first and pre-generates ids. Then one G batch runs:
    1. `guard_assert(own order, status='REQUESTED', distributor ACTIVE)`
    2. `UPDATE orders SET status='UNDER_REVIEW', opened_at`
    3. for each allocation, `INSERT purchase_orders(DRAFT, provider_id=alloc.provider, version 0)` + `INSERT po_items(qty=alloc.qty, seed_key='<order>:<provider>')`
    4. if choice_kg > 0, `INSERT purchase_orders(DRAFT, provider NULL)` + `po_items(seed_key='<order>:choice')`
    5. post: `guard_assert(coverage = qty_kg)`
  - Exactly-once comes from two places: only one batch can pass the REQUESTED guard, and `UNIQUE(seed_key)` turns any re-run into a rolled-back batch.
  - Opening an already-opened order is a read.
  - The distributor order page triggers open with a client-side POST on mount when status is REQUESTED, never in a GET or server render, so Link prefetch cannot open orders.
  - Case 1 (30 t: Anjani 10, Ambuja 20) gives 2 drafts. Case 2 (15 t, no split) gives 1 draft with provider NULL ("choose provider").
- **Draft edits** (all require the parent PO to be DRAFT, owned by the actor, and the client `version` to match; they bump `version`):
  - `PATCH /pos/:id {providerId|null, ratePerTonne?}`: C, and providerId must satisfy `activeLink(provider, actor)`.
  - `PATCH /po-items/:id {qtyTonnes}`: C on the item with an `EXISTS(parent DRAFT, version)` predicate, plus a version bump. This may temporarily break coverage; place re-checks it.
  - `POST /po-items/:id/split {qtyTonnes, providerId|null}`: G. The original item loses x. A new DRAFT PO (target provider) gets an item for the same order with x, which must be 0 < x < item qty.
- **Combine** `POST /pos/combine {pos:[{id,version}]}` (2..20 POs):
  - Allowed only when all POs are DRAFT, have the same distributor (the actor) and the same NON-NULL provider. Drafts with a NULL provider must get a provider first.
  - Read the items, then `domain/combine-plan.ts` picks the target as the oldest PO. For each source order, the plan either merges into the target item for that order (summing qty) or moves the item.
  - G: pre asserts every version and state is unchanged; writes are the item UPDATE/DELETE/INSERT from the plan, deleting the emptied POs and bumping the target version; post asserts that per-order coverage is unchanged and `UNIQUE(po_id, order_id)` holds.
  - Different providers, other distributors' POs or non-DRAFT POs give 422 `NOT_COMBINABLE`.
- **Split back** `POST /pos/:id/split-back {version, itemIds}`: G. It moves the chosen items to a new DRAFT PO with the same provider. At least one item must stay.
- Stale versions give 409 `STALE` ("This draft changed. Refresh and try again").

### 6.6 Provider invoice (V6 adapted)
- Create is a C `INSERT...SELECT` (V6 shape). Preconditions:
  - PO own and `status='DISPATCHED'`;
  - provider ACTIVE;
  - invoice_date >= PO placed date (IST) and <= todayIst;
  - qty + SUM(existing qty) <= po.qty_kg.
- Amount is computed in SQL. The V6 amount cap against the PO total is removed, because the PO rate is optional in v2 and the provider prices its own invoice.
- Batch follow-up: the PO -> INVOICED rollup, self-guarded.
- Multiple invoices per PO are allowed. UNIQUE(provider_id, invoice_no) violations give 409 DUPLICATE_INVOICE_NO.
- The provider may still invoice after a link revoke (the existing accepted gap stays, user decision 2026-11-10).

### 6.7 Provider payments (manual, S7)
- Create is a C `INSERT...SELECT`. Preconditions:
  - invoice.distributor_id = actor and actor ACTIVE;
  - amount > 0 and amount + SUM(existing) <= invoice amount (otherwise 422 AMOUNT_EXCEEDS_OUTSTANDING);
  - invoice_date <= paid_on <= todayIst.
- Batch follow-ups: `UPDATE provider_invoices SET status='PAID', paid_at WHERE id AND status='UNPAID' AND SUM(payments) >= amount_paise`, then the PO -> PAID rollup.
- No update or delete endpoints exist. Providers are read-only.

### 6.8 Customer invoice and payment
- **Create** (`POST /orders/:id/invoice {invoiceNo, invoiceDate, ratePerTonne}`) is a C `INSERT...SELECT` with these preconditions:
  - order own and DELIVERED, distributor ACTIVE;
  - invoice_date >= delivered date (IST) and <= todayIst;
  - qty_kg is copied from the order; amount uses the formula.
  - The batch follow-up moves the order to INVOICED.
  - UNIQUE(order_id) prevents a second invoice (409 ALREADY_INVOICED). UNIQUE(distributor_id, invoice_no) gives 409 DUPLICATE_INVOICE_NO.
- **Payment request**: C `ISSUED -> PAYMENT_REQUESTED`. The amount is already frozen on the invoice.
- **Razorpay**: the rev-1 section 7 flow stands, re-keyed from request_line to customer_invoice:
  - `POST /api/payments/order {customerInvoiceId}` requires the customer's own invoice in PAYMENT_REQUESTED. It reuses the existing CREATED attempt. Otherwise it inserts a CREATED row first; the partial unique index serializes double-clicks. Then it calls the gateway and stores razorpay_order_id.
  - `/verify` moves to AUTHORIZED only.
  - Webhook batch: INSERT webhook_events (a unique conflict returns 200 duplicate); `UPDATE payments SET PAID WHERE status<>'PAID'`; `UPDATE customer_invoices SET status='PAID', paid_at WHERE id AND status='PAYMENT_REQUESTED'`; `UPDATE orders SET PAID WHERE status='INVOICED'`; then set processed_at.
  - The amount and currency are compared against the immutable payments.amount_paise, read before the batch. A mismatch only records `result=amount_mismatch`.
  - `payment.failed` sets FAILED unless the payment is already PAID. The invoice stays PAYMENT_REQUESTED and the customer can retry.
  - Full payment only.

## 7. Balances and analytics (SQL aggregates over indexed columns)
- Provider outstanding per distributor = SUM(provider_invoices.amount) - SUM(provider_payments.amount) GROUP BY distributor_id WHERE provider_id = actor. The distributor's "payable to provider" is the mirror query.
- Distributor money to receive = SUM(customer_invoices.amount WHERE status <> 'PAID'). Paid = SUM(status='PAID').
- Admin, per distributor:
  - sales = SUM(customer_invoices.amount WHERE PAID);
  - tonnes per provider = SUM(purchase_orders.qty_kg WHERE status NOT IN ('DRAFT','REJECTED')) GROUP BY provider.
- Admin transport list = dispatches JOIN purchase_orders and users, paginated.
- Customer list with order history = orders GROUP BY customer, plus a detail page.
- Reconciliation tests run against the seed fixtures.

## 8. API surface
JSON. Errors use `{success:false, error, code, fields?}`. Lists use `?page<=MAX_PAGE(1000)&limit<=50`. Mutations check Origin and enforce body <= 16KB and `enforceActionLimit(scope)` (ACTION_MAX_PER_MIN).

| Method | Path | Role |
|---|---|---|
| POST | /api/auth/register, /login, /logout; GET /api/me | unchanged |
| GET | /api/directory/providers (ACTIVE providers + own link state) | DISTRIBUTOR |
| GET | /api/directory/distributors (ACTIVE distributors + own link state) | CUSTOMER |
| GET | /api/distributors/:id/providers (providers ACTIVE-linked to that distributor; requires the caller's ACTIVE link) | CUSTOMER |
| GET/POST | /api/links (own, either side) / {targetId} | lower tier creates |
| POST | /api/links/:id/approve, /reject | upper tier |
| POST | /api/links/:id/revoke | either side |
| POST/GET | /api/orders | CUSTOMER create; CUSTOMER/DISTRIBUTOR own list `?status=` |
| GET | /api/orders/:id (document chain: allocations, items, POs, dispatch, invoices, payments, per visibility rules) | CUSTOMER / DISTRIBUTOR own |
| POST | /api/orders/:id/cancel | CUSTOMER |
| POST | /api/orders/:id/open, /reject {reason}, /deliver | DISTRIBUTOR |
| POST | /api/orders/:id/invoice | DISTRIBUTOR |
| GET | /api/pos `?status=`, /api/pos/:id | DISTRIBUTOR own (incl. DRAFT); PROVIDER own (never DRAFT) |
| PATCH | /api/pos/:id {version, providerId?, ratePerTonne?} | DISTRIBUTOR, DRAFT |
| PATCH | /api/po-items/:id {version, qtyTonnes} | DISTRIBUTOR, DRAFT |
| POST | /api/po-items/:id/split, /api/pos/combine, /api/pos/:id/split-back, /api/pos/place | DISTRIBUTOR, DRAFT |
| POST | /api/pos/:id/accept, /reject {reason}, /dispatch | PROVIDER |
| POST | /api/pos/:id/invoices | PROVIDER, DISPATCHED |
| GET | /api/provider-invoices (renamed from /api/invoices) | PROVIDER own; DISTRIBUTOR own read-only |
| POST | /api/provider-invoices/:id/payments | DISTRIBUTOR |
| GET | /api/provider-payments | DISTRIBUTOR own; PROVIDER own read-only |
| GET | /api/balances | DISTRIBUTOR (payable per provider, receivable); PROVIDER (outstanding per distributor) |
| GET | /api/customer-invoices | DISTRIBUTOR own; CUSTOMER own |
| POST | /api/customer-invoices/:id/payment-request | DISTRIBUTOR |
| POST | /api/payments/order {customerInvoiceId}, /api/payments/verify, /api/payments/:id/refresh; GET /api/payments, /api/payments/:id/status | CUSTOMER own |
| POST | /api/webhooks/razorpay | HMAC only |
| GET/POST | /api/admin/users..., /approve, /reject (revoke = reject an ACTIVE user; UI added) | ADMIN |
| POST | /api/admin/links {upperId, lowerId} | ADMIN |
| GET | /api/admin/analytics/distributors, /api/admin/dispatches, /api/admin/customers, /api/admin/customers/:id | ADMIN |

Zod limits:
- qtyTonnes uses the 4.3 regex;
- reason, address and reference are length-capped (reason <= 300, reference <= 64);
- arrays (allocations, pos, itemIds) have at most 20 entries;
- ids are UUID format.

Server pages read through services directly, never over HTTP.

## 9. Security and kept decisions
These are carried over unchanged:
- argon2id;
- DB sessions with rotation;
- login limits (email 5/15min, IP 50/15min, TRUST_PROXY);
- REGISTER_MAX_PER_HOUR, REQUEST_MAX_PER_HOUR (now orders), ACTION_MAX_PER_MIN;
- 16KB body cap; MAX_PAGE=1000; limit<=50;
- the Origin check;
- 404-not-403 for out-of-scope rows;
- approval deletes sessions only on reject;
- rzp_live_ refused at boot, fake gateway only with E2E=1 off Vercel;
- every accepted trade-off listed in rev 1 section 4.

New in v2:
- Every list and detail query gets an ownership predicate, plus the visibility rules in section 5. Combined POs make cross-customer leakage the main new risk, so the customer projection is item-scoped.
- Directories expose id, business name and city only.
- The provider sees the delivery address and customer display name, never email or phone. Default: revisit if drivers need a contact number.
- Link checks happen inside the guarded statements, so there is no TOCTOU window.
- Security review is required on the links, orders and drafts slice and on the payments slice.

## 10. Testing approach (delta)
- **Unit**:
  - tonnes/kg parsing at the edges (0.001, 1000, 1000.001, "1.2345");
  - the amount formula and its rounding vectors;
  - `order-status` rollup, `combine-plan` and `split-plan`;
  - zod schemas, HMAC vectors, guard error detection.
- **Integration** (temp SQLite per file):
  - both must-pass cases end to end at the service level;
  - double open creates drafts exactly once, including two concurrent `openOrder` calls via Promise.all;
  - cancel/open race;
  - place blocked on NULL provider or coverage mismatch;
  - combine rules (same provider only, merges same-order items, split-back);
  - provider reject regenerates drafts and reverts the order;
  - dispatch rollup; invoice qty cap; PO -> INVOICED -> PAID rollups;
  - payment over outstanding rejected;
  - webhook cases from rev 1, re-keyed;
  - link gating (pending, rejected or revoked links block order and place; revoke keeps documents payable);
  - cross-tenant isolation for every new list, including customer A never seeing customer B's items in a combined PO and providers never seeing drafts;
  - analytics reconciliation.
- **E2E** (workers=1, Chromium, headless): S1 approval; S2 link request/approve; S3+S4 Case 1 and Case 2 verbatim; S5 accept/dispatch/invoice; S6 invoice + fake-gateway signed webhook, duplicate and failure; S7 record payment + balances; S8 admin numbers; one 360px customer run.
- Coverage stays at 80%+ on src/server and src/lib.

## 11. Migration from v1
**Keep as-is**:
- tables users, sessions, login_attempts;
- `server/auth/*` (password, session, cookie, guards, with-auth, origin, decide, rate-limit, action-limit, http), `server/config.ts`, `server/errors.ts`, `server/db/client.ts`;
- services `users.ts`, `admin-users.ts`;
- `lib/money.ts`, `lib/roles.ts`, `lib/validation/{auth,admin,pagination}.ts`;
- public pages, approvals UI, ui/login/register/logout components;
- scripts env/migrate;
- the V1/V2 tests and the page-caps and http-error tests.

**Rework**:
- `lib/qty.ts` and `lib/qty-input.ts` move to kg/tonnes; `lib/constants.ts` replaces MAX_PRICE_PAISE with MAX_RATE_PER_TONNE_PAISE and MAX_ORDER_KG.
- `lib/split.ts` changes to provider allocations with a remainder.
- `services/invoices.ts` becomes `provider-invoices.ts`. Keep `isUniqueViolation`, the INSERT...SELECT + diagnose shape, and the preview/grouping queries. Swap in kg/tonne fields, require DISPATCHED, and drop the amount cap.
- `invoice-form`, `invoice-list` and `provider-orders` shells get re-labelled to tonnes.
- `seed.ts` seeds the v2 demo plus active links.

**Drop and rebuild**:
- tables requests, request_lines, purchase_orders (v1), invoices (v1);
- services requests.ts, lines.ts, pos.ts;
- routes /api/requests/*, /api/lines/*, /api/pos/[id]/confirm, /api/invoices;
- components new-request-form, request-card, distributor-lines, po-manager (its UI patterns can be reused);
- tests tied to bags or lines (integration requests/lines/pos/invoices/qa-v6 and their e2e specs) are rewritten in their slice.

**Approach**:
1. Keep migrations 0000-0004 as history; 0004 is V6's and stays.
2. Edit schema.ts to v2. `drizzle-kit generate` produces `0005_v2`. Hand-check that it DROPs v1 tables child-first (invoices, purchase_orders, request_lines, requests) and CREATEs v2 tables and indexes. Partial unique indexes use Drizzle `.where()`.
3. `drizzle-kit generate --custom --name=guard_assert` produces `0006` with the view and trigger.
4. A forward migration was picked over squashing 0000-0004 because any DB that already applied 0000-0004 (local, test or Turso) upgrades cleanly and the drizzle journal stays consistent. No production data exists, so dropping v1 trade tables is safe. This is the one documented exception to "additive-only migrations".
5. Locally, `scripts/reset-db.ts` deletes dev.db, migrates and seeds. Tests already build fresh temp DBs.
6. Any future table rebuild still ends with `PRAGMA foreign_key_check` (the note in schema.ts stays).
7. Turso is migrated only after the user explicitly says yes.

## 12. Environment variables
These are unchanged from rev 1 section 9, plus ACTION_MAX_PER_MIN, REGISTER_MAX_PER_HOUR, REQUEST_MAX_PER_HOUR, LOGIN_IP_MAX_ATTEMPTS, TRUST_PROXY, COOKIE_SECURE and E2E (already in config.ts). There are no new variables in v2.

## 13. Hosting and operations
These are unchanged from rev 1 section 10: Vercel Hobby bom1 + Turso ap-south-1, manual migrations, dump before migrating, and no deploy without the user's explicit yes.

## 14. Consequences
- **Positive**:
  - one item table, `po_items`, gives full traceability from order to PO and back, and makes combine, split and reject plain row moves;
  - every transition is a single atomic statement or batch with SQL-level guards, so double clicks and races cannot double-create drafts, over-invoice or over-pay;
  - stored order status keeps lists fast, and the rollup is spec'd in one pure function.
- **Negative**:
  - guarded batches need a pre-read plus version asserts, so the code is more ceremonious than interactive transactions;
  - `guard_assert` is a custom-SQL migration that drizzle-kit snapshots don't see;
  - SQLite has a single writer, which is fine at MVP scale;
  - the PO rate being optional means PO totals can be NULL, and UIs must handle that.
- **Alternatives rejected**:
  - deriving order status on every read: too slow for lists and harder to filter;
  - storing provider on po_items instead of the PO: combine and place rules get harder, and a PO is per provider by definition;
  - separate link tables per tier: duplicates the service code;
  - interactive transactions: the known local deadlock.
- **Revisit when**: there are more than about 10k users, live payments, partial dispatch (dispatches is already a separate table), or credit terms.

**Status**: Proposed (rev 2) · **Date**: 2026-11-10

---

## V22 Transport (rev 3 delta)

### HANDOFF (read this first, <=12 lines)
1. Migration is `0007_v22_transport` (0006_guard_assert exists; 0005_v2 + 0006 frozen). `drizzle-kit generate --name=v22_transport`.
2. 0007: (a) rebuild `users` so role CHECK allows 'TRANSPORTER' (drizzle __new_users copy/drop/rename); (b) CREATE `transport_requests` with partial UNIQUE(po_id) WHERE status IN ('REQUESTED','ACCEPTED'); (c) ALTER dispatches ADD transport_request_id (nullable FK).
3. Users rebuild safe only because libSQL `client.migrate()` wraps batch in PRAGMA foreign_keys=off (sqlite3.js:292, hrana.js:216). `runMigrations` must then run `PRAGMA foreign_key_check` and fail on any rows.
4. States REQUESTED -> ACCEPTED | REJECTED | CANCELLED. ACCEPTED final; "dispatched" derived from PO status. Every write = C conditional UPDATE / INSERT...SELECT with version in WHERE; 0 rows -> diagnose(): 404 / 409 INVALID_STATE / 409 STALE.
5. Create: distributor owns PO, PO ACCEPTED, transporter ACTIVE TRANSPORTER; 2nd open -> 409 TRANSPORT_OPEN. Distributor edit/cancel only REQUESTED. Transporter accept/reject only REQUESTED; reject reason required (422).
6. Dispatch gate: POST /api/pos/:id/dispatch {dispatchDate, transportRequestId}; batch pre-asserts ACCEPTED request for PO; vehicle + driver phone copied from request in SQL; else 409 TRANSPORT_NOT_ARRANGED. Free-text vehicleNo/driverPhone removed. Old dispatch rows untouched.
7. No create/cancel/dispatch race (PO leaves ACCEPTED only via dispatch, which needs non-editable ACCEPTED request). Only edit-vs-accept race; version covers it.
8. Wrong role 403 FORBIDDEN; unapproved 403 PENDING; foreign row 404 (ADR s9) — QA asserts 404 where PRD says 403.
9. Transporter projections = explicit column lists: no rate/total/amount/invoice/payment/email/customer. INVOICED/PAID shown as "Dispatched".
10. Fix first: pos.ts scope()/toView() and orders.ts scope() fail-open for unknown roles -> explicit assertRole + exhaustive switch.
11. Files: services/transport-requests.ts, transport-views.ts, deliveries.ts, domain/transport-status.ts, lib/validation/transport.ts + fields.ts; change po-provider, directory, admin-users, analytics, pos, orders.
12. Test seams: `now` param, fixture arrangeTransport() (existing dispatch tests + S5 e2e need it), key-denylist isolation test, migrate-from-0006 test, Promise.all races.

### V22.1 Migration 0007_v22_transport
1. users rebuild (drizzle-generated): __new_users with CHECK(role IN ('CUSTOMER','DISTRIBUTOR','PROVIDER','ADMIN','TRANSPORTER')), INSERT...SELECT all columns, DROP users, rename, recreate users_email_unique. Hand-check column order, NOT NULLs, email unique vs 0000. FKs off -> no cascade; sessions survive; other FKs resolve by name after rename.
2. CREATE TABLE transport_requests:

| Column | Type | Notes |
|---|---|---|
| id | text PK | uuidv7 |
| po_id | text NOT NULL FK purchase_orders | |
| distributor_id | text NOT NULL FK users | denormalised ownership predicate |
| transporter_id | text NOT NULL FK users | |
| status | text NOT NULL DEFAULT 'REQUESTED' | CHECK IN ('REQUESTED','ACCEPTED','REJECTED','CANCELLED') |
| version | integer NOT NULL DEFAULT 0 | bumped every write |
| vehicle_no | text NOT NULL | same CHECK as dispatches (4-12, [A-Z0-9]) |
| driver_name | text NOT NULL | length(trim) 2..80 |
| driver_phone | text NOT NULL | same CHECK as dispatches (^[6-9]\d{9}$) |
| pickup_date | text NOT NULL | YYYY-MM-DD IST, GLOB check |
| note | text NULL | <= 300 |
| reject_reason | text NULL | status<>'REJECTED' OR length(trim)>0; <= 300 |
| decided_at, cancelled_at | integer NULL | epoch ms |
| created_at, updated_at | integer NOT NULL | |

Extra CHECK transporter_id <> distributor_id.
Indexes: transport_requests_po_open_uq UNIQUE(po_id) WHERE status IN ('REQUESTED','ACCEPTED') (Drizzle .where(), like payments_invoice_created_uq; also guarantees single-row LEFT JOIN); transport_requests_po_idx (po_id, created_at); transport_requests_transporter_idx (transporter_id, status, created_at); transport_requests_distributor_idx (distributor_id, status, created_at).
3. ALTER TABLE dispatches ADD transport_request_id text REFERENCES transport_requests(id), nullable. If drizzle-kit emits rebuild, hand-check.
Notes: no PO/order status changes; no vehicles/trips; driver_name read via request. scripts/migrate.ts adds post-migrate fk check. Tests build DBs through real migrator. Turso migrated only after user yes + dump.

### V22.2 State machine and enforcement
REQUESTED -> ACCEPTED (transporter), -> REJECTED (transporter + reason), -> CANCELLED (distributor). REJECTED/CANCELLED terminal, free PO for new request. "Dispatched" = PO status IN (DISPATCHED, INVOICED, PAID) or dispatch row with this transport_request_id.

| Action | Actor | Enforcement (single statement) | 0 rows diagnose |
|---|---|---|---|
| create | DISTRIBUTOR | INSERT...SELECT FROM purchase_orders p JOIN users t (TRANSPORTER, ACTIVE) WHERE p.id, p.distributor_id=actor, p.status='ACCEPTED', activeUser(actor), NOT EXISTS dispatch; service checks pickup_date >= todayIst(now) | unique -> 409 TRANSPORT_OPEN; not own 404; dispatched+ 409 ALREADY_DISPATCHED; other 409 INVALID_STATE; transporter 422 TRANSPORTER_UNAVAILABLE |
| edit {version, fields} | DISTRIBUTOR | UPDATE ... WHERE distributor_id=actor AND status='REQUESTED' AND version=:v | 404 / 409 INVALID_STATE / STALE |
| cancel {version} | DISTRIBUTOR | status='CANCELLED', cancelled_at, same guard | same |
| accept {version} | TRANSPORTER | status='ACCEPTED', decided_at WHERE transporter_id=actor, REQUESTED, version, activeUser, EXISTS PO ACCEPTED | 404 / 409 INVALID_STATE / STALE |
| reject {version, reason} | TRANSPORTER | as accept + reject_reason; Zod reason 1..300 no control chars (reuse rejectOrderSchema) | 422 VALIDATION |

Rules: transporter accepts exactly what they saw (edit between -> accept 409 STALE). Creating request does not bump purchase_orders.version. Changing transporter = cancel + new request. Revoked transporter: REQUESTED stays cancellable; ACCEPTED stays dispatchable. Known dead end: ACCEPTED cannot be undone before dispatch (later: withdraw).

### V22.3 Dispatch gate (po-provider.ts dispatchPo)
dispatchSchema = {dispatchDate, transportRequestId: uuid}.strict() (old vehicle fields -> 422). Pre-read open request; missing/not ACCEPTED/id mismatch -> 409 TRANSPORT_NOT_ARRANGED. Batch pre-assert EXISTS ACCEPTED request for PO; INSERT dispatches SELECT tr.vehicle_no, tr.driver_phone, tr.id FROM transport_requests; post-assert transport_request_id = :tr; rollups unchanged. Date rule unchanged (placed <= date <= today); UI prefills min(pickup_date, today).

### V22.4 API routes
All mutations: Origin check, body <= 16KB (readJson), enforceActionLimit(db, "transport", actor.id). Lists page<=1000, limit<=50. UUID ids.

| Method | Path | Role | Result |
|---|---|---|---|
| GET | /api/directory/transporters ?q&page&limit | DISTRIBUTOR | ACTIVE transporters: id, businessName, city |
| POST | /api/pos/:id/transport-requests | DISTRIBUTOR | 201 {id, version}; 404, 409 INVALID_STATE/ALREADY_DISPATCHED/TRANSPORT_OPEN, 422 VALIDATION/TRANSPORTER_UNAVAILABLE/INVALID_DATE |
| PATCH | /api/transport-requests/:id | DISTRIBUTOR | 200; 404, 409 INVALID_STATE/STALE, 422 |
| POST | /api/transport-requests/:id/cancel | DISTRIBUTOR | 200; 404, 409 |
| POST | /api/transport-requests/:id/accept | TRANSPORTER | 200; 404, 409 |
| POST | /api/transport-requests/:id/reject | TRANSPORTER | 200; 404, 409, 422 |
| GET | /api/transport-requests ?status&page&limit | TRANSPORTER / DISTRIBUTOR | role projection |
| GET | /api/transport-requests/:id | TRANSPORTER / DISTRIBUTOR | 404 out of scope |
| POST | /api/pos/:id/dispatch {dispatchDate, transportRequestId} | PROVIDER | 201; 404, 409 INVALID_STATE/TRANSPORT_NOT_ARRANGED/CONFLICT, 422 INVALID_DATE |
| GET | /api/deliveries ?flag=needs_transport\|at_risk | DISTRIBUTOR | T5 |
| GET | /api/pos/:id, /api/orders/:id | existing | + transport block |
| GET | /api/admin/dispatches | ADMIN | + transporterName, driverName (searchable) |
| GET/POST | /api/admin/users | ADMIN | APPROVABLE_ROLES += TRANSPORTER |

Registration: validation/auth.ts role enum += TRANSPORTER, treated like PROVIDER (PENDING, businessName, phone, city). ROLE_VALUES, lib/roles.ts (DASHBOARD_PATH "/transporter"), nav.ts.

### V22.5 Isolation and visibility
- TRANSPORTER: only tr.transporter_id = actor (all statuses). Request fields; PO no, qty_kg, derived state; provider business_name + city; distributor business_name; items qty_kg, address, city, pincode, needed_by. Never rates/totals/invoices/payments/balances/emails/user phones/customer names. Reads only in transport-views.ts (never listPos/getPo/orders.ts).
- DISTRIBUTOR: own requests all statuses incl. reject_reason.
- PROVIDER: own non-DRAFT POs: open request status; details only when ACCEPTED, else "Waiting for distributor/transporter".
- CUSTOMER: item-scoped; ACCEPTED request only (transporter, vehicle, driver name + phone, pickup date); else "Transport being arranged"; REJECTED/CANCELLED filtered in SQL. Reverses rev-2 "customer never sees driver phone" for V22 blocks only.
- ADMIN: read-all via dispatch join; approval only.
- Fail-open fix: assertRole at exported entries of pos.ts / orders.ts; exhaustive scope switch throws on unknown role.

### V22.6 Files (each < 500 lines)
drizzle/0007_v22_transport.sql + snapshot + journal; schema.ts (role CHECK, transportRequests, dispatches.transportRequestId); db/guard.ts (move isUniqueViolation); lib/constants.ts, roles.ts, nav.ts, validation/auth.ts; validation/fields.ts (extract vehicleNo, driverPhone, isRealDate, blankToNull); validation/transport.ts; domain/transport-status.ts (canAct, transporterPoState, customerTransportView, deliveryFlags); services/transport-requests.ts; services/transport-views.ts (listForTransporter, getForTransporter, listForDistributor, transportForPos); services/deliveries.ts. Changed: po-provider, directory (listTransporterDirectory), admin-users, analytics, pos, orders, scripts/migrate.ts, scripts/seed.ts ("Meena Transports" + one ACCEPTED request). Routes: api/directory/transporters, api/pos/[id]/transport-requests, api/transport-requests/[id]/{route,cancel,accept,reject}, api/deliveries. Pages: app/transporter/ (dashboard, requests/[id]), distributor/deliveries; reuse components/transport-details.tsx.

### V22.7 Test seams
- Unit: transport-status table + flags (at-risk today vs yesterday; INVOICED/PAID -> "Dispatched"); Zod vehicle normalise, phone, reason required, empty edit 422.
- Integration (real migrator): migrate 0006 + v2 seed -> 0007, counts kept, sessions intact, fk_check empty, TRANSPORTER insert ok, 2nd open request violates index. Happy path T2-T4 (dispatch row transport_request_id, copied vehicle/phone, rollup). Gate: none/REQUESTED/REJECTED/CANCELLED/wrong id -> 409 TRANSPORT_NOT_ARRANGED; legacy unaffected. Races: two creates; accept vs cancel; edit vs accept; double accept. Isolation: transporter B on A's request 404; transporter on pos/orders/invoices/balances 403; pending 403 PENDING + not in directory; customer B no block on A's combined PO. Key-denylist /rate|total|amount|paise|invoice|payment|email|balance/i on transporter + customer transport payloads.
- Fixture tests/fixtures/transport.ts arrangeTransport(db, {poId, transporterId?, accept=true}); all existing dispatch tests + S5 e2e must use it.
- E2E (1 worker, chromium): T1 register -> pending -> admin approve -> dashboard; T2-T4 with "Waiting" state before accept; 360px customer transport block.

### V22.8 Decisions
| Decision | Why | Cost | Rejected |
|---|---|---|---|
| Rebuild users for role CHECK | keeps DB invariant | hand check + fk_check + Turso dump | drop CHECK; separate transporters table |
| Partial unique one-open-per-PO | race-proof, single-row join | needs history index | NOT EXISTS batch |
| Dispatched derived | no new status, PO single source | views join PO | DISPATCHED request status |
| Dispatch copies from DB | client can't forge vehicle | old clients 422 | compare client values |
| 404 foreign rows | ADR s9, no existence leak | differs from PRD 403 wording | 403 |

**Status**: Proposed (rev 3 delta) · **Date**: 2026-11-22
