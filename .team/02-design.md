## HANDOFF (v2)
Screens: auth /login /register /pending (S1) | Admin /admin/{approvals,distributors,customers,transport} (S1,S2,S8)
  Provider /provider/{distributors,orders,invoices,payments} (S2,S5,S7) | Distributor /distributor/{providers,customers,orders,pos,invoices-in,invoices-out,payments} (S2,S3,S4,S5,S6,S7)
  Customer /customer/{distributors,orders,orders/new,invoices,payments} (S2,S3,S6). Detail pages: /orders/[id], /pos/[id], /invoices/[id] per role.
Component library: shadcn/ui (Tailwind + Radix), lucide-react. Tokens: unchanged from v1 (below).
Layout: customer = top bar + bottom tab bar (Orders | Distributors | Invoices | Pay), 360px min. Staff = sidebar >=1024px, top bar + Sheet below; sidebar items = the role tabs.
Formats: qty "30 t" (up to 3 decimals, trailing zeros trimmed, "12.5 t"); input is tonnes, stored kg. Money "Rs 1,23,456.00" (en-IN, paise/100). Rate "Rs 6,200.00 / t".
Risky UX: (1) order form live "Unallocated -> distributor's choice" remainder, never blocks submit; (2) draft-PO review blocks Place until every item has a provider and per-order sums match; (3) "Paid" only after webhook ("Confirming payment..." poll); (4) 7 distributor tabs: group in sidebar as Network / Sales / Purchasing / Money; mobile Sheet.
Removed: transport planner. Admin "transport" = read-only dispatch records.
Next: fullstack-developer

## Tokens (unchanged)
:root{--bg:#F8F7F4;--surface:#FFF;--text:#1C1917;--muted:#6B655E;--border:#E4E0D8;--primary:#C2410C;--primary-fg:#FFF;--success:#15803D;--warning:#B45309;--danger:#B91C1C;--info:#1D4ED8;--focus:#1D4ED8}
.dark{--bg:#171513;--surface:#211E1B;--text:#F5F2EC;--muted:#A8A198;--border:#3A3631;--primary:#FB923C;--primary-fg:#1C1917;--success:#4ADE80;--warning:#FBBF24;--danger:#F87171;--info:#60A5FA;--focus:#93C5FD}
Type: system sans; 12 caption, 14 table, 16 body/inputs (mobile min), 20 h2, 24 h1, 32 KPI. Space 4 8 12 16 24 32 48. Radius 6 inputs, 12 cards. Numbers tabular-nums, right-aligned in tables.

## Status badges (icon + text + color, never color alone)
Order: Requested=info | Under review=warning | POs placed=info-outline | Dispatched=primary | Delivered=success-outline | Invoiced=warning | Paid=success | Rejected=danger | Cancelled=muted(strike icon)
PO: Draft=muted-dashed | Placed=info | Accepted=primary-outline | Rejected=danger | Dispatched=primary | Invoiced=warning | Paid=success
Link: Pending=warning | Active=success | Rejected=danger | Revoked=muted. Account: Pending approval=warning.
Customer sees order statuses only; PO drafts never shown to customer or provider.

## Shared patterns
Shell: header [logo | role badge | user menu]; Tabs/sidebar per role; page title + primary CTA. Toaster, Skeleton, Alert(destructive)+Retry, 403 -> own dashboard + toast.
DocChain (component, on every order/PO/invoice detail): horizontal breadcrumb-style chips, vertical on mobile:
  [Order #12 Paid] > [PO #31 Anjani 10 t Invoiced] [PO #32 Ambuja 20 t Dispatched] > [Inv A-77 (provider)] > [Cust Inv #5] > [Payment pay_xx]
  Each chip links to the role-visible doc; docs the viewer may not see render as plain muted text (customer sees Order > Customer invoice > Payment only; provider sees PO > its invoices > receipts).
Tables become stacked label:value cards <768px. Lists paginated (25/page) beyond 500 rows.
Empty states always say next step. Qty input: inputmode decimal, suffix "t", error "Max 3 decimals" / "Must be > 0 and <= 1000 t".

## Screen: Auth  (/login /register /pending)  [S1]  (unchanged)
Login: email, password, Log in, Register link. Register: name, email, password, role RadioGroup (Customer|Distributor|Provider), phone, + business name & city if not customer; helper "Needs admin approval".
/pending: clock card, "Waiting for admin approval", logout; rejected: "Your account was not approved".
States: bad creds generic alert; rate limit "Too many attempts, try in a minute"; button spinner.

## Screen: Links (all roles)  [S2]
Distributor /distributor/providers   Customer /customer/distributors   (Provider /provider/distributors, Distributor /distributor/customers = same table, approver view)
+--------------------------------------------------+
| [ Find providers ]                 (Sheet/Dialog) |
| Requests to you (approver tabs only)              |
|  Ravi Traders, Pune  [Pending] [Approve][Reject]  |
| Linked                                            |
|  Anjani Cement, Hyd  [Active]   [Revoke]          |
|  Ambuja Depot        [Pending - you requested] [Cancel]
+--------------------------------------------------+
Directory sheet: search by name/city, only admin-approved parties; row button [Request link]; already linked rows show badge.
Requester sees Active + own Pending/Rejected; hides others' revoked. Revoke = AlertDialog "New orders will be blocked. Existing documents stay."
Upper-tier tabs (Provider Distributors, Distributor Customers) = Link table + per linked party a row link to their orders/invoices/receipts/transactions (provider: detail /provider/distributors/[id] with tabs Orders | Invoices | Receipts, KPI Outstanding).
States: empty "No links yet. Find a provider."; error toast, row unchanged.

## Screen: Customer order form  (/customer/orders/new)  [S3]
+-- 360px ------------------------------+
| Distributor [ Giri Traders  v ]       |  Select, ACTIVE links only
| Total quantity [ 30 ] t               |
| Address [___________________]         |
| City [______]  Pincode [______]       |
| Needed by [ date ]  (min today)       |
| Split by provider (optional)  [switch]|
|  Anjani Cement   [ 10 ] t             |  rows = providers ACTIVE-linked to chosen distributor
|  Ambuja          [ 20 ] t             |
|  Distributor's choice  0 t  (auto)    |  read-only remainder
|  Allocated 30 / 30 t                  |
| [ Place order ]  sticky bottom        |
+---------------------------------------+
Behavior: switch off = all qty "distributor's choice". Changing distributor reloads provider rows and clears allocations. Remainder = total - sum, live. Over-allocation: red "2 t over total", submit disabled. Remainder > 0 is valid: text "15 t left to the distributor to choose". [Split evenly] link. Providers list empty: "Giri has no linked providers; Giri will choose".
Validation: qty >0 <=1000 3dp; pincode 6 digits; past date "Pick today or a later date". No active distributor -> empty state + button to /customer/distributors.
Flow: pick distributor -> total -> address/date -> (optional split) -> Place -> toast -> order detail.

## Screen: Customer Orders / detail  (/customer/orders, /customer/orders/[id])  [S3,S6]
Card: "#12 30 t | Giri | needed 10 Nov | [Under review]". Lines: "Anjani 10 t, Ambuja 20 t, Distributor's choice 0 t". [Cancel order] only while Requested (AlertDialog). Detail adds DocChain, delivery address, status timeline (Requested > Under review > POs placed > Dispatched > Delivered > Invoiced > Paid). Dispatched shows vehicle/driver phone if provided.
Invoices tab (/customer/invoices): card per invoice: no, date, 30 t x Rs 6,500 / t = total, [Payment requested] [ Pay Rs 1,95,000.00 ] (full only). Payments tab: date | distributor | amount | status.
Pay states: after Razorpay return "Confirming payment..." (poll 3s up to 30s) then Paid; fail/cancel -> "Payment didn't go through. [Retry]".
Empty: "No orders yet" + [New order]. Bottom bar: Orders | Distributors | Invoices | Payments; [+ New] FAB on Orders.

## Screen: Distributor Customers / Customer Orders  (/distributor/customers, /distributor/orders)  [S2,S3,S4]
Customers: link table (see Links). Orders: Table Order# | Customer | Qty | City | Needed by | Status | [Open]. Filter chips by status; Requested sorted first, count badge on tab.
[Open] on a Requested order -> becomes Under review and drafts appear (idempotent). Order detail /distributor/orders/[id]: header + address + DocChain, "Drafts" panel (below), then once placed: PO list; when all POs Dispatched: [Mark delivered] (AlertDialog); when Delivered: [Create customer invoice].
Customer invoice form (Dialog): Invoice no, Date, Qty (prefilled order qty, read-only), Rate Rs/t, Amount (live, read-only), helper "Internal record, not a GST invoice". After save: [Send payment request].

## Screen: Draft-PO review  (/distributor/pos, tab Drafts; also panel on order detail)  [S4]
+---------------------------------------------------------------+
| Drafts (4)           [Combine selected (2)]   [Place selected] |
| [ ] Draft D1  Provider [Anjani v]  Total 10 t    Rate [__] opt |
|      #12 Ramu  10 t [edit qty]                    [Split item] |
| [ ] Draft D2  Provider [Ambuja v]  Total 20 t                  |
|      #12 Ramu  20 t                                            |
| [ ] Draft D3  Provider [Choose provider v !]  15 t             |
|      #14 Sita  15 t         (Alert: "Choose a provider")       |
+---------------------------------------------------------------+
Provider Select lists only ACTIVE-linked providers. Item edit: qty input; "Split item" Dialog = rows (provider, qty) with live "Remaining 0 t"; sum per source order must equal ordered qty or inline error "Order #12 needs 30 t, drafts total 25 t".
Combine: enabled only when >=2 selected drafts share a provider; else tooltip "Select drafts of the same provider". Result = one draft with one item row per source order (order# chip links back). Combined draft shows [Split back] while draft.
Place: AlertDialog "Place 2 POs? Providers will see them." Disabled with reason text while any item lacks a provider. Optional PO rate Rs/t.
States: empty "No drafts. Open a customer order to create drafts"; provider rejected PO -> new draft with banner "Anjani rejected: <reason>. Choose another provider."

## Screen: POs to Providers  (/distributor/pos)  [S4,S5]
Tabs: Drafts | Placed | All. Table PO# | Provider | Qty | Orders (chips) | Status | Dispatch info. Detail /distributor/pos/[id]: items per source order, status timeline, provider reject reason, dispatch details (date, vehicle, driver phone), DocChain, linked provider invoices.

## Screen: Provider Purchase Orders / dispatch  (/provider/orders, /provider/orders/[id])  [S5]
Table PO# | Distributor | Qty | Delivery city | Status | Actions. Placed: [Accept][Reject] (Reject Dialog, reason required). Accepted: [Mark dispatched]. Dispatched: [Add invoice].
Detail shows items with each customer's delivery address and needed-by.
Dispatch Dialog: Dispatch date (default today), Vehicle no (optional), Driver phone (optional, 10 digits). Helper "Whole PO is dispatched at once". Confirm.
Provider Invoices (/provider/invoices): Table Inv# | PO | Distributor | Qty | Rate | Amount | Paid | Status; [New invoice] picks Dispatched POs. Form: Invoice no (unique), Date (>= PO date), Qty t (max = remaining, hint "Remaining 12 t of 30 t"), Rate Rs/t, Amount live. Errors: duplicate no, qty over remaining.
Provider Payments (/provider/payments): KPI Outstanding; table per distributor: Invoiced | Received | Outstanding; expand = receipts (date, amount, mode, reference). Read-only; note "Recorded by the distributor".

## Screen: Distributor Invoices & Payments  [S5,S6,S7]
Invoices from Providers (/distributor/invoices-in): read-only table Inv# | Provider | PO | Qty | Amount | Paid | Outstanding | [Record payment]. Dialog: Amount (max outstanding, prefilled), Date, Mode (Select: Cash, UPI, Bank transfer, Cheque), Reference. Error "Exceeds outstanding Rs X".
Invoices to Customers (/distributor/invoices-out): Inv# | Order | Customer | Amount | Status (Draft/Requested/Paid) | [Send payment request].
Payments (/distributor/payments): two KPI cards "Payable to providers" and "Money to receive"; tabs Paid to providers (by provider, receipts) | Received from customers (Razorpay id, status).

## Screen: Admin  (/admin/*)  [S1,S2,S8]
Tabs: Approvals(n) | Distributors | Customers | Transport.
Approvals: Name|Role|City|Date|[Approve][Reject] plus approved list with [Revoke]. Admin force-link: Dialog on Distributors tab "Link parties" (pick two) -> Active.
Distributors: KPI Paid sales; table Distributor | Paid sales Rs | Tonnes per provider (chips, placed+ POs) | >. Detail adds provider breakdown.
Customers: list > /admin/customers/[id] order history (status, t, distributor).
Transport: read-only table Dispatch date | PO | Distributor | Provider | Vehicle | Driver.
Empty "No activity yet". Mobile: tabs scroll, cards.

## Accessibility (unchanged + v2)
Contrast >= 4.5:1 both themes; hit targets >= 44px; 16px inputs; 2px --focus ring; every input labelled, errors via aria-describedby + role=alert; dialogs trap/return focus; tables use th scope; DocChain is a nav landmark with aria-label "Document chain" and current item aria-current; draft selection checkboxes have row-specific labels; disabled Place/Combine expose reason text (not tooltip-only); reduced-motion respected; theme follows prefers-color-scheme.
