## HANDOFF (read this first, <=12 lines)
Problem: B-grade cement trade in India runs on phone/paper; CementLink chains customer order -> provider POs -> provider invoice -> customer invoice -> payment in one app.
Primary user: Distributor (hub); also Customer, Provider, Admin. 4 roles, one login, own-data isolation.
MVP stories: S1 login+admin approval | S2 linking | S3 customer order w/ optional provider split | S4 auto-draft POs, edit/combine/place | S5 provider accept/reject/dispatch + invoice | S6 customer invoice + Razorpay test pay + webhook | S7 manual payments to provider + balances | S8 admin analytics
Key defaults: tonnes, up to 3 decimals, stored as integer kg | INR integer paise, rate per tonne | provider prices on its invoice, distributor prices on customer invoice (PO rate optional) | PO dispatched whole, invoices may be partial | distributor marks order "delivered" | links requested by the lower tier, approved by the upper tier | one customer invoice per order, paid in full only
Statuses: Order requested>under review>POs placed>dispatched>delivered>invoiced>paid (+rejected, cancelled) | PO draft>placed>accepted/rejected>dispatched>invoiced>paid
Non-goals (Later): GPS, native app, SMS/WhatsApp, GST e-invoicing, distributor->provider online pay, refunds, partial customer payment. (Transport now scoped as V22 below.)
Open questions: v2 none BLOCKING (defaults at bottom). V22: none BLOCKING (Q1 answered; defaults at V22 end).
V22 (see "## V22 Transport planner" at end): new TRANSPORTER role + dashboard; distributor requests transport from a transporter after provider ACCEPTS the PO and shares vehicle/driver details; transporter accepts/rejects; provider sees details and dispatches with them; customer sees read-only. Stories T1-T5; reuses POs/dispatches; new migration 0006; no GPS, no paid services.
Must-pass: Ramu/Giri/Anjani/Ambuja, both cases, in S3+S4 (verbatim below).
Next: ui-designer + architect (parallel), then planner re-slices using "Delta from v1". (V22: planner may slice now; Q1 answered.)

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
- Transport/truck planner (now scoped as V22 below), GPS, native app, SMS/WhatsApp, GST e-invoicing/PDF, distributor->provider online payments, live Razorpay/settlement, partial customer payments, refunds, credit terms, stock, customer delivery confirmation, ratings, multi-role accounts, CSV export, audit log, email verification/password reset.

## Open Questions (all non-blocking, defaults stated)
- Provider/distributor-initiated invites (vs requester-initiated links)? Default: lower tier requests, upper tier approves.
- Distributor may PO to a provider without a customer order (stock)? Default: no in MVP; POs originate from orders.
- Customer pays before delivery? Default: invoice only after "delivered".
- Provider may record receipts itself? Default: distributor records, provider read-only.

## V22 Transport planner
Problem: Distributors arrange transport with their own transporter contacts by phone, and providers do not know who is collecting, in what vehicle, or when; dispatch details are typed ad hoc (S5).
Real-world flow: provider ACCEPTS PO -> distributor requests transport from a transporter and shares transport details -> transporter accepts/rejects -> provider sees the details and dispatches the PO using them.
Users: Transporter (NEW role, own dashboard), Distributor (requests), Provider (dispatches), Customer and Admin (read-only visibility).
Reuses: purchase_orders (ACCEPTED), po_items -> orders (address, city, pincode, needed_by), dispatches (date, vehicle, driver), existing dispatch rules (whole PO, placed date <= date <= today), admin approval flow (S1), V19 admin transport list.
New data (migration 0006; 0005_v2 frozen): role value TRANSPORTER on users (company name, phone, city; admin-approved like provider); table transport_requests (po_id, distributor_id, transporter_id, vehicle_no, driver_name, driver_phone, pickup_date, note, status REQUESTED/ACCEPTED/REJECTED/CANCELLED, reject_reason, timestamps; at most one REQUESTED/ACCEPTED request per PO); nullable transport_request_id on dispatches. No new PO/order statuses. Provider vehicles/trips model is DROPPED.
Defaults decided: transporter logs in and accepts/rejects | distributor enters vehicle/driver/pickup date (transporter accepts or rejects, cannot edit) | transporters onboard by self-register + admin approval, listed in an approved directory (no link handshake) | provider CANNOT dispatch until the request is ACCEPTED (strict gate) | customer sees transporter name, vehicle no, driver name/phone, status read-only.

### T1 - Transporter role and dashboard  [priority: must]
As a transporter I want to register and see only the requests addressed to me.
Acceptance:
- Given a visitor registers as Transporter, When they log in before admin approval, Then "pending approval" page, no actions, and they are absent from the directory; after approval they reach the Transporter dashboard.
- Given an approved transporter, When they open the dashboard, Then they see only requests addressed to them (status, PO tonnes, provider name and city, delivery address/city/pincode, needed-by, distributor name, vehicle/driver/pickup date); no rates, invoices or payments anywhere.
- Given a non-transporter opens transporter pages/APIs, or a transporter opens another role's or another transporter's data, Then 403.

### T2 - Distributor requests transport  [priority: must]
As a distributor I want to request transport for an accepted PO from a transporter and share the vehicle/driver details.
Acceptance:
- Given Giri's PO is ACCEPTED, When he picks an approved transporter and enters vehicle no (normalised as in dispatch), driver name, driver phone, pickup date (>= today, <= needed-by optional warning only), optional note, Then a request is saved REQUESTED and shown on the PO.
- Given the PO is not ACCEPTED (placed, rejected, dispatched, other distributor's PO), Then API returns 409/403 and nothing is created.
- Given an open (REQUESTED/ACCEPTED) request exists, When he creates another for the same PO, Then 409; he may cancel a REQUESTED request, or edit its details while REQUESTED, but not once ACCEPTED/dispatched.
- Given a REJECTED request, Then he sees the reason and may create a new request with another transporter.

### T3 - Transporter accepts or rejects  [priority: must]
As a transporter I want to accept or reject a request.
Acceptance:
- Given a REQUESTED request addressed to Meena Transports, When she accepts, Then status is ACCEPTED and the distributor and provider see it.
- Given she rejects without a reason, Then validation error; with a reason, status REJECTED and the distributor sees it.
- Given a request that is CANCELLED, ACCEPTED, REJECTED or already dispatched, When she acts again, Then 409; another transporter acting on it gets 403.

### T4 - Provider sees details and dispatches  [priority: must]
As a provider I want to see the transport details and dispatch the PO using them.
Acceptance:
- Given Anjani's ACCEPTED PO with an ACCEPTED transport request, When she opens it, Then she sees transporter, vehicle, driver name/phone and pickup date, and "Dispatch" is enabled prefilled with these values (dispatch date, placed date <= date <= today).
- Given the PO has no request, or request is REQUESTED/REJECTED/CANCELLED, When she dispatches, Then API returns 409 "transport not arranged" and the UI shows "Waiting for distributor/transporter".
- Given she dispatches, Then PO becomes DISPATCHED (whole PO), the dispatch row stores vehicle/driver and the request id, order rollups follow S4, and distributor, transporter and admin (V19 transport list) see it.
- Given a dispatched PO, Then no new or changed request is possible; POs dispatched before V22 are untouched.
- Given another provider's PO, Then 403.

### T5 - Customer and distributor visibility  [priority: should]
As a customer I want to know who is bringing my cement; as a distributor I want one place to track transport.
Acceptance:
- Given Ramu's order has a transport request ACCEPTED or dispatched, When he opens the order, Then he sees transporter name, vehicle no, driver name/phone, pickup date and status (read-only); with none or REQUESTED he sees "Transport being arranged"; REJECTED/CANCELLED details are never shown.
- Given Giri opens "Deliveries", Then he sees only his POs with request status, transporter, vehicle, and "Needs transport" on ACCEPTED POs without an open request; needed-by < today and not dispatched shows "At risk".
- Given another customer or distributor, Then they never see these details (403/empty).

## V22 MVP cut vs later
- MVP: T1-T4 must; T5 should (may split to the next slice). One request per PO, one PO per request, strict dispatch gate.
- Later: transporter-edited vehicle/driver, multi-PO trips on one truck, transporter "picked up/in transit/delivered" statuses, transporter rates/invoices/payments, distributor-saved transporter contacts or link handshake, relaxing the gate for ad hoc dispatch, driver view, admin transporter analytics, SMS/WhatsApp notify, delivery confirmation.

## V22 Non-goals
- No GPS or live tracking, no maps/route APIs, no paid services; free-tier hosting/DB only, runs on 8GB laptop.
- No new PO/order status, no change to invoicing or payments, no schema change beyond TRANSPORTER role + transport_requests + nullable dispatch link (new migration 0006; 0005_v2 stays frozen).

## V22 Open Questions
- None BLOCKING.
- Q2 non-blocking: Strict gate (no dispatch until transporter ACCEPTED)? Default: yes. Fallback if too rigid: allow dispatch once details are shared, even if REQUESTED.
- Q3 non-blocking: Can the legacy free-text vehicle on dispatch (S5) remain? Default: no for new dispatches (details come from the request); old rows keep their text.
- Q4 non-blocking: Does the transporter need to edit vehicle/driver (real transporters often assign trucks)? Default: no, distributor enters; revisit after pilot feedback.
- Q5 non-blocking: Directory pick vs link handshake for transporters? Default: directory of admin-approved transporters, no handshake.
- Q6 non-blocking: Is T5 in this slice? Default: yes, marked should; may split.
