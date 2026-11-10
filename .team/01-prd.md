## HANDOFF (read this first, <=12 lines)
Problem: Small B-grade cement buyers, distributors and manufacturers in India coordinate by phone/paper; CementLink gives one place to request, aggregate demand, order, bill and pay.
Primary user: Distributor (hub of the flow); secondary Customer (builder), Provider, Admin.
MVP stories: S1 role login + admin approval | S2 customer request (split across distributors) | S3 distributor demand total + POs to providers | S4 provider billing entry | S5 payment request + Razorpay test pay + webhook | S6 admin analytics | S7 transport planner [should]
Defaults assumed: units = bags (50 kg; 20 bags = 1 tonne); INR only, integer paise; distributor sets price/bag when accepting a request line; truck capacity set per truck (default 10 t); one email+password login, one role per account; customers self-sign-up, providers/distributors self-register as PENDING until admin approves.
Non-goals: native app, GPS, route optimisation, SMS/WhatsApp, GST e-invoicing, delivery proof, refunds, ratings.
Open questions: none BLOCKING (see bottom for non-blocking).
Next: ui-designer + architect (parallel)

## User Stories

### S1 - Role login and admin approval  [priority: must]
As a user I want to log in and land on my own role dashboard so that I only see what is mine; as admin I want to approve distributors and providers so that only vetted parties transact.
Acceptance:
- Given a new visitor, When they register as Customer, Then they can log in immediately and see the Customer dashboard.
- Given a visitor registers as Distributor or Provider, When they log in before approval, Then they see a "pending approval" page and no actions.
- Given an admin views the pending list, When they approve or reject, Then status changes and the user gets access (or is blocked) on next login.
- Given a logged-in user of role X, When they open another role's URL or API, Then access is denied (403/redirect).
- Given a seeded admin account exists, When admin logs in, Then the Admin dashboard shows.

### S2 - Customer creates request, split across distributors  [priority: must]
As a customer I want to request cement from one or many distributors so that I can fill my need even if one distributor lacks stock.
Acceptance:
- Given an approved-distributor list, When customer enters total qty (bags or tonnes), delivery location (address, city, pincode), needed-by date and allocates qty to 1..N distributors, Then allocations must sum to total or the form blocks submit.
- Given needed-by date in the past, When submitting, Then validation error.
- Given a submitted request, When saved, Then one request line per distributor is created with status "Sent".
- Given customer dashboard, When opened, Then each request shows per-distributor line status (Sent / Accepted / Rejected / Paid) and payment history.
- Given tonnes entered, When saved, Then qty is stored/displayed in bags too (1 t = 20 bags).

### S3 - Distributor demand total and purchase orders  [priority: must]
As a distributor I want to see all incoming requests, their total demand, and raise POs to providers so that I can source what I promised.
Acceptance:
- Given requests sent to distributor D by many customers, When D opens the dashboard, Then all D's lines (and only D's) are listed with a total accepted-demand figure in bags and tonnes.
- Given a Sent line, When D accepts it with price per bag (or rejects), Then status updates and customer sees it.
- Given accepted demand, When D creates a PO choosing one approved provider, qty, and rate, Then PO is saved as "Placed" with computed total; D may create several POs to different providers.
- Given a PO, When created, Then it appears in that provider's "orders received" list (many distributors -> one provider works).
- Given PO qty exceeds unfulfilled accepted demand, Then show a warning (allowed; D may stock).

### S4 - Provider billing entry  [priority: must]
As a provider I want to record cement sold to each distributor with an invoice so that the sale is documented.
Acceptance:
- Given a received PO, When provider marks it Confirmed or Rejected, Then distributor sees the status.
- Given a confirmed PO, When provider enters invoice (invoice no., date, qty supplied, rate, amount), Then invoice is saved and linked to the PO; qty supplied cannot exceed PO qty.
- Given provider dashboard, When opened, Then it shows orders received, qty sold per distributor, and invoice list with totals in INR.
- Given an invoice, When viewed by the distributor, Then it is read-only.
- Invoice is an internal record (not a GST e-invoice).

### S5 - Payment request and Razorpay test payment  [priority: must]
As a distributor I want to send a payment request to a customer and have the customer pay in-app so that payment status is tracked automatically.
Acceptance:
- Given an Accepted line with price, When D sends a payment request, Then customer sees a "Pay Rs X" action; amount = qty x price/bag, in INR.
- Given customer taps Pay, When Razorpay Checkout (test mode) completes successfully, Then the line shows Paid only after the server receives a verified webhook (signature checked), not from the browser callback alone.
- Given payment fails or is cancelled, When returning, Then status stays "Payment pending" and the customer can retry.
- Given a duplicate webhook delivery, When processed twice, Then state and amounts are unchanged (idempotent).
- Given any flow, Then no card/UPI details are stored; only Razorpay order/payment IDs and status.
- Given customer history, Then past payments list with date, amount, distributor, status.

### S6 - Basic admin analytics  [priority: must]
As admin I want visibility across the platform so that I can monitor activity.
Acceptance:
- Given admin dashboard, Then it lists per-distributor: total sales (INR, paid), qty requested, and qty ordered per provider.
- Given admin opens a distributor, Then transport plans for it are visible.
- Given admin opens customers, Then list with each customer's order history.
- Numbers match underlying records (QA reconciles against seeded data).

### S7 - Transport planner  [priority: should]
As a distributor I want to know how many truck trips I need so that I can plan deliveries.
Acceptance:
- Given accepted lines grouped by delivery city/pincode and a truck capacity (tonnes), When D opens the planner, Then trips needed per location = ceil(total tonnes / capacity) and overall total is shown.
- Given D edits capacity, Then numbers recalculate.
- Given D saves a plan, Then it is stored (date, locations, trips, truck count) and visible to admin.
- No routing, maps or GPS.

## Non-functional
- Mobile-first customer pages (360px width usable); dashboards usable on tablet+.
- Money: INR only, stored as integer paise; shown with Indian digit grouping.
- Security: hashed passwords, server-side role checks on every API, Razorpay keys in env vars only, webhook signature verification, rate-limit login.
- Data isolation: a user only reads rows belonging to them (customer sees own requests; distributor own lines/POs; provider own POs/invoices).
- Budget: free-tier hosting and DB, Razorpay test mode only (no live keys in MVP); runs on 8GB laptop without Docker.
- Accessibility: labelled forms, keyboard operable, readable contrast.
- Pages respond in under 2s on free tier for lists up to ~500 rows (paginate beyond).

## Later (not in MVP)
- Native mobile app; GPS tracking; route optimisation; SMS/WhatsApp notifications.
- GST e-invoicing, PDF invoices; live Razorpay keys and settlement/payouts.
- Partial payments, refunds, credit terms; stock/inventory; ratings; multi-role accounts; email verification and password reset (basic reset may be pulled in if cheap).
- CSV export of analytics; audit log.

## Open Questions
- Non-blocking: Is one account allowed multiple roles? Default: no, one role per account.
- Non-blocking: Do customers pay full amount per line only (no partial)? Default: full only.
- Non-blocking: Who sets cement price: distributor per line (default) vs a provider price list.
- Non-blocking: Should provider/distributor be admin-created instead of self-registered? Default: self-register + approval; admin-create can come later.
- Non-blocking: Delivery confirmation / order completion status? Default: not in MVP.
