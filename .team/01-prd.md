## HANDOFF (read this first, <=12 lines)
Problem: B-grade cement trade in India runs on phone/paper; CementLink chains customer order -> provider POs -> provider invoice -> customer invoice -> payment in one app.
Primary user: Distributor (hub); also Customer, Provider, Admin. 4 roles, one login, own-data isolation.
MVP stories: S1 login+admin approval | S2 linking | S3 customer order w/ optional provider split | S4 auto-draft POs, edit/combine/place | S5 provider accept/reject/dispatch + invoice | S6 customer invoice + Razorpay test pay + webhook | S7 manual payments to provider + balances | S8 admin analytics
Key defaults: tonnes, up to 3 decimals, stored as integer kg | INR integer paise, rate per tonne | provider prices on its invoice, distributor prices on customer invoice (PO rate optional) | PO dispatched whole, invoices may be partial | distributor marks order "delivered" | links requested by the lower tier, approved by the upper tier | one customer invoice per order, paid in full only
Statuses: Order requested>under review>POs placed>dispatched>delivered>invoiced>paid (+rejected, cancelled) | PO draft>placed>accepted/rejected>dispatched>invoiced>paid
Non-goals (Later): transport/truck planner, GPS, native app, SMS/WhatsApp, GST e-invoicing, distributor->provider online pay, refunds, partial customer payment.
Open questions: none BLOCKING (non-blocking defaults at bottom).
Must-pass: Ramu/Giri/Anjani/Ambuja, both cases, in S3+S4 (verbatim below).
Next: ui-designer + architect (parallel), then planner re-slices using "Delta from v1".

## User Stories
### S1 - Role login and admin approval  [priority: must] (built V1-V2, mostly unchanged)
As a user I want my own role dashboard; as admin I want to approve providers and distributors so only vetted parties trade.
Acceptance:
- Given a visitor registers as Customer, When they log in, Then Customer dashboard (customers need no admin approval but can only trade with ACTIVE-linked distributors).
- Given Provider/Distributor registers, When they log in before approval, Then "pending approval" page, no actions, and they do not appear in any directory.
- Given admin approves/rejects, Then access changes on next login; revoke and re-approve supported.
- Given role X opens another role's page or API, Then 403/redirect; every API checks role and row ownership server-side.

### S2 - Linking  [priority: must]
As a distributor/customer I want to link with providers/distributors so that we can trade.
Model: Provider<->Distributor and Distributor<->Customer. Link states: pending, active, rejected, revoked. Only admin-APPROVED providers/distributors are listed in directories.
Acceptance:
- Given approved providers listed, When distributor Giri requests a link to Anjani, Then link is pending; When Anjani approves, Then active and visible in both Providers/Distributors tabs.
- Given approved distributors listed, When customer Ramu requests a link to Giri, Then pending until Giri approves; Ramu's Distributors tab shows only ACTIVE or his own pending links.
- Given a pending/rejected/revoked link, When anyone tries to order/PO across it, Then API rejects (customer cannot order from, nor distributor PO to, an unlinked party).
- Either side may revoke; revoke blocks new orders/POs but existing documents stay visible and payable.
- Provider "Distributors" tab lists only its linked distributors with their orders, invoices, receipts, transactions.
- Admin may also create/force an active link (seed/demo convenience).

### S3 - Customer order with optional provider split  [priority: must]
As a customer I want to order total tonnes from ONE linked distributor, optionally split by provider, so that I can steer brands.
Acceptance:
- Given Ramu picks Giri (ACTIVE link), enters total qty (tonnes, >0, max 3 decimals, <=1000), address (address, city, pincode), needed-by date >= today, Then order saved status "requested".
- Given a split, When Ramu allocates qty only to providers ACTIVE-linked to Giri, Then sum of allocations must be <= total; the remainder is stored as "distributor's choice"; allocation to unlinked provider is rejected.
- Given no split, Then entire qty is "distributor's choice".
- Given past needed-by date, Then validation error.
- Customer may cancel while status is "requested"; once Giri opens it, it is locked.
- MUST-PASS CASE 1: Ramu orders 30 t from Giri: 10 t Anjani, 20 t Ambuja -> order saved with those two allocations, 0 t distributor's choice.
- MUST-PASS CASE 2: Ramu orders 15 t, leaves provider unselected -> order saved with 15 t distributor's choice.
- Customer Orders list shows status and links to its POs, invoice and payment (document chain).

### S4 - Auto-drafted POs, edit, combine, place  [priority: must]
As a distributor I want drafts created automatically per provider so I can review and place POs fast.
Acceptance:
- Given Giri opens a "requested" order for the first time, Then order becomes "under review" and draft PO items are created once (idempotent on reopen): one per allocated provider, plus one unassigned item for any "distributor's choice" qty.
- MUST-PASS CASE 1: Giri opens Ramu's 30 t order and sees 2 draft POs: Anjani 10 t, Ambuja 20 t. He reviews and places both; Anjani and Ambuja each see their PO in Purchase Orders tab (status placed, 10 t / 20 t, Ramu's delivery address visible).
- MUST-PASS CASE 2: Giri opens Ramu's 15 t order and sees a draft showing "choose provider"; he picks Ambuja and places it; Ambuja sees a 15 t PO.
- Given a draft, Giri can edit provider (only ACTIVE-linked) and qty, and split an item across providers; Place is blocked while any item has no provider or an order's items do not sum to the ordered qty.
- Combine: Given drafts for the SAME provider from several of Giri's orders, When he combines them, Then ONE draft PO is made holding one item per source order (traceable); drafts of different providers or from other distributors cannot be combined; a combined PO can be split back while still draft.
- Given "Place order" on selected drafts, Then each becomes "placed" and is sent to its provider; PO rate per tonne is optional.
- Order status: "POs placed" when all its items sit in placed POs; "dispatched" when all those POs are dispatched; Giri then marks "delivered".
- If a provider rejects a PO, Then order stays "POs placed"/under review, items return to a new draft so Giri can pick another provider.

### S5 - Provider PO handling and invoice  [priority: must]
As a provider I want to accept, reject, dispatch and invoice POs so the sale is documented.
Acceptance:
- Given a placed PO, When provider accepts or rejects (reason on reject), Then distributor sees status.
- Given an accepted PO, When provider marks dispatched (dispatch date; optional vehicle no, driver phone), Then PO is dispatched as a whole (no partial dispatch) and those details appear to distributor and admin (transportation details).
- Given a dispatched PO, When provider creates invoice (unique invoice no, date >= PO date, qty tonnes, rate per tonne), Then it links to the PO; sum of invoice qty per PO <= PO qty; multiple invoices per PO allowed; PO becomes "invoiced" when invoiced qty = PO qty.
- Distributor sees invoices read-only in "Invoices from Providers"; invoices are internal records (not GST e-invoices).
- Provider sees only its own POs/invoices; Payments tab per S7.

### S6 - Customer invoice and Razorpay test payment  [priority: must]
As a distributor I want to bill the customer and send a payment request so that payment is tracked automatically.
Acceptance:
- Given an order in "delivered", When Giri creates the customer invoice (invoice no, date, qty = order qty, rate per tonne; amount computed server-side in paise), Then order becomes "invoiced"; one invoice per order; invoice shows links to order and PO(s) and provider invoice(s).
- Given an invoice, When Giri sends payment request, Then Ramu sees "Pay Rs X" in Invoices and Payments tabs.
- Given Ramu pays via Razorpay Checkout (test mode), Then invoice and order become "paid" ONLY after a signature-verified webhook, never from the browser callback.
- Given failure/cancel, Then invoice stays unpaid and retry works; duplicate webhook is idempotent; no card/UPI data stored (only Razorpay order/payment IDs, status); app refuses rzp_live_ keys.
- Payment history lists date, amount, distributor, status. Full payment only.

### S7 - Manual payments to provider and balances  [priority: must]
As a distributor I want to record payments to providers so that balances are accurate; as provider I want to see receipts and outstanding.
Acceptance:
- Given a provider invoice, When Giri records a payment (amount, date, mode, reference), Then it is stored against that invoice; amount cannot exceed invoice outstanding.
- Outstanding per distributor (provider view) = sum of its invoice amounts - sum of recorded payments; distributor view shows the mirror "payable to provider".
- Invoice is "paid" when payments >= amount; PO becomes "paid" when fully invoiced and all invoices paid.
- Distributor "money to receive" = customer invoices - Razorpay-paid amounts.
- Provider Payments tab: receipts per distributor + outstanding; provider cannot edit or delete receipts (MVP: distributor-recorded, provider read-only).

### S8 - Admin analytics  [priority: must]
As admin I want platform visibility.
Acceptance:
- Per distributor: sales (paid customer invoices, INR), and tonnes ordered from each provider (placed+ POs).
- Transportation details: dispatch records (date, vehicle, driver, PO, distributor) listed.
- Customer list with each customer's order history (status, tonnes, distributor).
- Numbers reconcile to seeded data (QA checks).

## Non-functional
- Customer pages mobile-first (360px); dashboards tablet+. Money INR integer paise, Indian digit grouping; qty integer kg shown as tonnes.
- Server-side role + ownership checks on all APIs; hashed passwords; login rate limit; webhook signature; secrets in env only.
- Free-tier hosting/DB, Razorpay test mode only, runs on 8GB laptop without Docker.
- Lists paginated beyond ~500 rows; a11y: labelled forms, keyboard operable.

## Delta from v1 (for planner)
- Units: bags (20/t) -> tonnes, integer kg, rate per tonne. Rework lib/qty, constants, validation, all UI/labels, schema columns (V1 libs, V3-V6).
- Order shape: v1 request split across DISTRIBUTORS (one line per distributor) -> v2 order to ONE distributor, split across PROVIDERS. Rework V3 fully (tables requests/request_lines).
- V4 distributor accept/price per line is REMOVED; replaced by open order -> under review + auto drafts (S4). Rework/replace V4.
- PO: free-form create -> drafts with items per source order, combine, place; statuses confirm/reject -> accept/reject + dispatched + invoiced + paid. Rework V5; reuse provider-orders UI shell.
- V6 provider invoice: keep form/qty cap/unique no.; change to tonnes, require dispatched, allow multiple invoices per PO, sum qty cap.
- New: linking (S2) incl. customer-side link gating; customer invoices; manual provider payments/balances; dispatch details; order delivered step; provider Distributors tab.
- V7 (todo): redesign - payments attach to customer invoice, not request line.
- V8 (todo): analytics fields changed (S8). V9 transport planner: DROPPED to Later.
- Unchanged: V1 auth, V2 approval/gating (add revoke UI), rate limits, Razorpay gateway design. No production data exists, so dev DB may be reset (new migration or regenerate).

## Later (not in MVP)
- Transport/truck planner, GPS, native app, SMS/WhatsApp, GST e-invoicing/PDF, distributor->provider online payments, live Razorpay/settlement, partial customer payments, refunds, credit terms, stock, customer delivery confirmation, ratings, multi-role accounts, CSV export, audit log, email verification/password reset.

## Open Questions (all non-blocking, defaults stated)
- Provider/distributor-initiated invites (vs requester-initiated links)? Default: lower tier requests, upper tier approves.
- Distributor may PO to a provider without a customer order (stock)? Default: no in MVP; POs originate from orders.
- Customer pays before delivery? Default: invoice only after "delivered".
- Provider may record receipts itself? Default: distributor records, provider read-only.
