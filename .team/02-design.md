## HANDOFF
Screens: /login /register /pending -> auth + approval gate (S1)
  /admin (approvals, analytics), /admin/distributors/[id], /admin/customers/[id] (S1, S6, S7 view)
  /customer (requests + payments), /customer/new (split form), /customer/requests/[id] (S2, S5)
  /distributor (demand + lines), /distributor/orders (POs), /distributor/transport (S3, S5, S7)
  /provider (orders received + invoices), /provider/orders/[id] (invoice form) (S4)
Component library: shadcn/ui (Tailwind + Radix); icons lucide-react. Match architect if they pick otherwise.
Tokens: defined below as CSS variables; INR via Intl.NumberFormat('en-IN') on paise/100 -> "₹1,23,456.00".
Layout: customer = single column, bottom-safe, 360px min. Staff roles = left sidebar >=1024px, top bar + Sheet menu below.
Risky UX decisions: (1) split-allocation form must show live "remaining bags" and block submit until 0; (2) "Paid" only after webhook, so show "Confirming payment..." state with polling; (3) tables become stacked cards <768px.
Next: fullstack-developer

## Tokens
:root{--bg:#F8F7F4;--surface:#FFF;--text:#1C1917;--muted:#6B655E;--border:#E4E0D8;
--primary:#C2410C;--primary-fg:#FFF;--success:#15803D;--warning:#B45309;--danger:#B91C1C;--info:#1D4ED8;--focus:#1D4ED8}
.dark{--bg:#171513;--surface:#211E1B;--text:#F5F2EC;--muted:#A8A198;--border:#3A3631;
--primary:#FB923C;--primary-fg:#1C1917;--success:#4ADE80;--warning:#FBBF24;--danger:#F87171;--info:#60A5FA;--focus:#93C5FD}
Type: system sans (Inter if available). 12 caption, 14 body-sm (tables), 16 body (min on mobile inputs), 20 h2, 24 h1, 32 KPI number. Weights 400/600.
Space (px): 4 8 12 16 24 32 48. Radius: 6 inputs/buttons, 12 cards. Money and quantities use tabular-nums, right-aligned in tables.
Status Badge colors: Sent=info, Accepted=primary-outline, Rejected=danger, Payment pending=warning, Paid=success, Placed=info, Confirmed=success, Pending approval=warning. Always icon/text plus color.
Formats: qty "40 bags (2 t)"; dates "03 Nov 2026"; money as above, never decimals dropped.

## Shared shell
+-- Staff >=1024px ----------------------------+  +-- Mobile (customer & staff) --+
| CementLink          [Role badge] [User v]    |  | CementLink     [User v]       |
|--------+-------------------------------------|  |-------------------------------|
| Nav    |  Page title            [Primary CTA]|  | Page title                    |
| items  |  KPI cards / tables                 |  | content, cards                |
+--------+-------------------------------------+  | [Sticky primary action]       |
Components: Sidebar, Sheet (mobile nav for staff), DropdownMenu (logout), Toaster, Skeleton.
Customer has no sidebar: top bar + bottom tab bar (Requests | New | Payments), tabs 56px high.
Global states: loading = Skeleton rows; error = Alert(destructive) + Retry; 403 = redirect to own dashboard with toast "Not allowed".

## Screen: Login / Register  (/login, /register, /pending)  [S1]
+--------------------------+
| CementLink               |
| Email [______________]   |
| Password [___________]   |
| [ Log in ]  (full width) |
| New here? Register       |
+--------------------------+
Register: Name, Email, Password, Role (RadioGroup: Customer | Distributor | Provider), Phone, then business name + city if not Customer. Helper under Distributor/Provider: "Needs admin approval before you can use the app."
/pending: Card with clock icon, "Waiting for admin approval", logout button, no nav. Rejected: "Your account was not approved" + logout.
States: error = inline field errors + Alert for bad credentials ("Email or password is wrong", no leak); rate-limited = "Too many attempts, try in a minute"; loading = button spinner, disabled.
Flow S1: Register -> (Customer) auto-login -> /customer | (others) -> /pending -> admin approves -> next login -> own dashboard.

## Screen: Admin dashboard  (/admin)  [S1, S6]
+----------------------------------------------------+
| Tabs: Approvals(3) | Distributors | Customers      |
| Approvals: Table Name|Role|City|Date|[Approve][Reject]|
| Distributors: KPI row: Paid sales | Bags requested   |
|  Table: Distributor | Paid sales ₹ | Bags requested  |
|   | Bags ordered per provider (chips) | > detail     |
+----------------------------------------------------+
Components: Tabs, Table, Badge, Button, AlertDialog (confirm reject), Card (KPI).
Detail /admin/distributors/[id]: header KPIs; table "Ordered per provider"; table "Transport plans" (date, locations, trips, trucks). /admin/customers/[id]: request history table with line status and paid amount.
Mobile: tabs scroll horizontally; tables become cards (label: value pairs); Approve/Reject stay 44px.
States: approvals empty = "No pending approvals"; analytics empty = "No activity yet"; approve success = toast and row removed; error = toast + row stays.

## Screen: Customer home  (/customer)  [S2, S5]
+-- 360px ------------------+
| Hello, Ravi                |
| [ + New request ]          |
| Requests | Payments (tabs) |
| +------------------------+ |
| | #12  50 bags (2.5 t)   | |
| | Needed by 10 Nov       | |
| | Sharma Traders  30 bags| |
| |  [Accepted] ₹3,00/bag  | |
| |  [ Pay ₹9,000.00 ]     | |
| | Gupta Cement    20 bags| |
| |  [Sent]                | |
| +------------------------+ |
+----------------------------+
Components: Card per request with line rows, Badge, Button, Tabs. Payments tab: list rows date | distributor | amount | status.
States: empty = "No requests yet" + New request button; loading = 3 skeleton cards; "Pay" only shown on lines with a payment request; after return from Razorpay the line shows "Confirming payment..." (spinner, poll every 3s up to 30s) then Paid; failed/cancelled = Badge "Payment pending" + inline "Payment didn't go through. [Retry]".

## Screen: New request  (/customer/new)  [S2]
+-- 360px ----------------------+
| Quantity [ 50 ] (bags|tonnes) |   ToggleGroup unit; shows "= 2.5 t / 50 bags"
| Address  [____________]       |
| City [______] Pincode [____]  |   pincode 6 digits, inputmode numeric
| Needed by [ date ]            |   min = today
| Split across distributors     |
|  [x] Sharma Traders [ 30 ]    |   Checkbox + number input, bags
|  [x] Gupta Cement   [ 20 ]    |
|  Allocated 50 / 50  OK        |   live; red "10 bags left to allocate"
|-------------------------------|
| [ Send request ] sticky bottom|
+-------------------------------+
Flow S2: fill qty -> pick distributors -> allocate -> remaining = 0 -> submit -> toast -> /customer.
Rules: submit disabled while remaining != 0, but show the reason text above button; "Split evenly" link helper; tonnes converted to bags (must be whole bags, else error "Must be a whole number of bags"). Past date = field error "Pick today or a later date". No approved distributors = empty state "No distributors available yet".
Detail /customer/requests/[id]: same card as home plus payment history per line.

## Screen: Distributor dashboard  (/distributor)  [S3, S5]
+----------------------------------------------------------+
| KPI: Accepted demand 240 bags (12 t) | Awaiting reply 5  |
|      Unfulfilled vs POs 40 bags                          |
| Tabs: Incoming | Accepted | All                          |
| Customer | Location | Qty | Needed by | Status | Actions |
|  Ravi    | Pune 411001 | 30 | 10 Nov | Sent | [Accept][Reject]
|  Accepted: Price ₹300.00/bag | Total ₹9,000.00 [Send payment request]
+----------------------------------------------------------+
Accept opens Dialog: price per bag (₹ prefix input), live total "30 x ₹300.00 = ₹9,000.00", [Confirm]. Reject = AlertDialog.
After request sent: row shows Badge "Payment requested"; then "Paid" (webhook).
Mobile: line cards; actions full-width buttons.
States: empty = "No requests yet. Customers will see you once approved."; error toast on failure.

## Screen: Purchase orders  (/distributor/orders)  [S3]
+--------------------------------------------+
| [ + New PO ]                               |
| PO# | Provider | Qty | Rate | Total | Status|
| Dialog: Provider (Select, approved only),  |
|  Qty bags, Rate ₹/bag, Total (live)        |
|  Warning Alert: "40 bags more than unfulfilled demand. You can still place it."
+--------------------------------------------+
Statuses: Placed, Confirmed, Rejected. Row expands to read-only invoice (S4: no. , date, qty supplied, rate, amount). Empty = "No purchase orders".

## Screen: Transport planner  (/distributor/transport)  [S7]
+-----------------------------------------------+
| Truck capacity [ 10 ] tonnes                  |
| Location (city+pincode) | Tonnes | Trips      |
| Pune 411001             | 12.5   | 2          |   trips = ceil(t / cap)
| Total trips: 5                                |
| [ Save plan ]                                 |
+-----------------------------------------------+
Components: Input number (min 0.5), Table, Button. Recalculates on input change. Saved plans list below (date, trips, trucks). Empty = "Accept some requests to plan trips".

## Screen: Provider dashboard  (/provider, /provider/orders/[id])  [S4]
+----------------------------------------------------+
| KPI: Orders received | Bags sold | Invoiced ₹        |
| Tabs: Orders | Invoices | By distributor            |
| PO# | Distributor | Qty | Rate | Status | Actions   |
|  Placed: [Confirm][Reject]                          |
|  Confirmed: [Add invoice]                           |
+----------------------------------------------------+
Invoice form (Dialog/page): Invoice no., Date, Qty supplied (max = PO qty, hint "Max 200 bags"), Rate ₹/bag (prefilled), Amount (auto = qty x rate, read-only). Validation: duplicate invoice no. and qty > PO qty show field errors. Helper: "Internal record, not a GST invoice."
By distributor tab: Distributor | Bags sold | Total ₹. Empty = "No orders yet".

## Accessibility
- Contrast: text on bg and primary-fg on primary >= 4.5:1 in both themes; status never color-only.
- Hit targets >= 44px; inputs 16px font (no iOS zoom); visible 2px focus ring (--focus).
- Every input has a visible Label, errors via aria-describedby and role=alert; dialogs trap focus and return it.
- Focus order follows visual order; sticky action bar reachable last; Tables use proper th scope; cards keep label: value text order.
- Respect prefers-reduced-motion; theme follows prefers-color-scheme.
