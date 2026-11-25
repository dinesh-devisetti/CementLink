## HANDOFF (v2 + V22)
Screens: auth /login /register /pending (S1) | Admin /admin/{approvals,distributors,customers,transport} (S1,S2,S8)
  Provider /provider/{distributors,orders,invoices,payments} (S2,S5,S7) | Distributor /distributor/{providers,customers,orders,pos,invoices-in,invoices-out,payments} (S2,S3,S4,S5,S6,S7)
  Customer /customer/{distributors,orders,orders/new,invoices,payments} (S2,S3,S6). Detail pages: /orders/[id], /pos/[id], /invoices/[id] per role.
Component library: shadcn/ui (Tailwind + Radix), lucide-react. Tokens: unchanged from v1 (below).
Layout: customer = top bar + bottom tab bar (Orders | Distributors | Invoices | Pay), 360px min. Staff = sidebar >=1024px, top bar + Sheet below; sidebar items = the role tabs.
Formats: qty "30 t" (up to 3 decimals, trailing zeros trimmed, "12.5 t"); input is tonnes, stored kg. Money "Rs 1,23,456.00" (en-IN, paise/100). Rate "Rs 6,200.00 / t".
Risky UX: (1) order form live "Unallocated -> distributor's choice" remainder, never blocks submit; (2) draft-PO review blocks Place until every item has a provider and per-order sums match; (3) "Paid" only after webhook ("Confirming payment..." poll); (4) 7 distributor tabs: group in sidebar as Network / Sales / Purchasing / Money; mobile Sheet.
V22 (see "## V22 Transport" at end): TRANSPORTER role (/transporter/requests), distributor Request transport on ACCEPTED PO + /distributor/deliveries, provider transport panel + strict dispatch gate, customer read-only card, admin Transporters tab. Replaces the old "removed transport planner"; no new components, no new tokens. Risky: strict gate must explain who to wait for; vehicle/driver prefill locked in dispatch dialog.
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
Dispatch Dialog: Dispatch date (default today), Vehicle no (optional), Driver phone (optional, 10 digits). Helper "Whole PO is dispatched at once". Confirm. (V22 supersedes: see Provider PO transport panel.)
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

## V22 Transport
Reuses shadcn Card, Table(->cards <768), Badge, Dialog, AlertDialog, Select, Input, Textarea, Alert, Tabs, Toaster; tokens unchanged. New shared bits are compositions only: TransportStatus Badge, TransportCard (read-only label:value block).
Transport badges: Requested=info | Accepted=primary-outline | Rejected=danger | Cancelled=muted(strike) | Needs transport=warning | At risk=danger-outline (clock icon) | Waiting=muted. Order of precedence on a PO row: Dispatched PO shows PO badge only.
Vehicle shown normalised upper-case "TS09AB1234". Phone "98765 43210". Dates "10 Nov 2026".

### Register + pending  (/register, /pending)  [T1]
Register role RadioGroup gains 4th option "Transporter"; extra fields (same slot as business): Company name*, City*, Phone*. Helper "Needs admin approval. Shown to distributors only after approval."
/pending (transporter): same clock card, copy "Waiting for admin approval. You will see requests here once approved." No nav, only [Log out]. Rejected: "Your account was not approved". Approved -> redirect /transporter/requests.

### Transporter dashboard  (/transporter/requests)  [T1,T3]
Shell: header [logo | "Transporter" badge | user menu]; single page, no tabs/sidebar. No rates/invoices/payments anywhere.
+-- 360px ---------------------------------+
| Transport requests        [New (2)]       |
| Filter chips: [Requested][Accepted][Past] |  default Requested
| +--------------------------------------+ |
| | PO #31  10 t        [Requested]      | |
| | Anjani Cement, Hyd -> Pune 411001    | |
| | Deliver: 12 Lake Rd | Needed 10 Nov  | |
| | Distributor: Giri Traders            | |
| | Vehicle TS09AB1234 | Ravi 98765 43210| |
| | Pickup 8 Nov | Note: gate 2          | |
| | [Reject]               [Accept]      | |
| +--------------------------------------+ |
+------------------------------------------+
>=768px: Table PO | Qty | Pickup (provider city) | Deliver to | Needed by | Distributor | Vehicle/Driver | Status | Actions.
Accept: one tap, AlertDialog "Accept PO #31? Provider will dispatch using these details." Reject: Dialog, Textarea "Reason" (required, 3-200 chars, error "Give a reason so the distributor can re-plan"), [Reject request] danger.
Past chip: Accepted/Rejected/Cancelled/Dispatched (Accepted shows "Dispatched 9 Nov" when so). Cancelled request disappears from Requested and shows greyed in Past; acting on stale card -> toast "Request changed. Refreshed." (409) and list reload.
States: empty "No requests yet. Distributors will send them here."; loading 3 Skeleton cards; error Alert + Retry; 403 -> own dashboard + toast.

### Admin transporter approval  (/admin/approvals, /admin/transport)  [T1]
Approvals tab: role column gains "Transporter"; row shows company, city, phone; same Approve/Reject/Revoke. Revoked transporter disappears from the directory; open requests stay visible to provider/distributor.
Transport tab: unchanged read-only dispatch table plus column "Transporter" (blank for pre-V22 rows); a segmented switch [Dispatches | Transporters] where Transporters = list Company | City | Phone | Open requests | status Badge.

### Distributor: Request transport  (/distributor/pos/[id])  [T2]
PO detail gets a "Transport" Card below items, state-driven:
- ACCEPTED, no open request: Alert info "Provider accepted. Arrange transport so they can dispatch." [Request transport] primary.
- REQUESTED: summary TransportCard + Badge Requested; [Edit details] [Cancel request] (AlertDialog "Cancel? The transporter will no longer see it.").
- ACCEPTED request: TransportCard + Badge Accepted, "Provider can now dispatch"; no edit/cancel (note "Locked once accepted").
- REJECTED: Alert danger "Meena Transports rejected: <reason>" + [Request another transporter] (form prefilled with previous vehicle/driver, transporter cleared).
- CANCELLED: muted line "Cancelled on 8 Nov" + [Request transport].
- Dispatched: read-only TransportCard "Dispatched 9 Nov". PO not ACCEPTED (placed/rejected): card hidden.
Form (Dialog on desktop, full-screen Sheet <768; same form for create/edit):
+------------------------------------+
| Transporter [ Meena Transports, Pune v ] |  Select + search, approved only
| Vehicle no  [ TS09AB1234 ]         |  normalised upper-case, strip spaces
| Driver name [__________]           |
| Driver phone [__________]  10 digits
| Pickup date [ date ] min today     |
|  warn (non-blocking): "After needed-by 10 Nov"
| Note (optional) [__________] 200   |
| [Cancel]            [Send request] |
+------------------------------------+
Edit: transporter Select disabled. Errors inline: "Pick a transporter", "Enter a valid vehicle no", "Phone must be 10 digits", "Pick today or a later date". 409 (open request exists / PO not accepted) -> Alert in dialog + refresh. Empty directory: "No approved transporters yet" and [Send] disabled.

### Distributor Deliveries  (/distributor/deliveries)  [T5]
Placed in sidebar group Purchasing (after "POs to Providers"); mobile Sheet item "Deliveries".
Table PO# | Provider | Qty | Needed by | Transport (Badge) | Transporter | Vehicle | Status | [Open]. Filter chips: All | Needs transport | At risk | In transit(Dispatched).
Flags: "Needs transport" (warning) = PO ACCEPTED, no open request, row action [Request transport] opens form; "At risk" (danger-outline) = needed-by < today and not dispatched, shown with any transport badge; sort At risk, Needs transport first. Mobile: cards, flag Badges at card top.
Empty: "No accepted POs yet" + link to POs.

### Provider PO transport panel + dispatch  (/provider/orders/[id])  [T4]
Card "Transport" above the dispatch action, by request state:
- ACCEPTED request: TransportCard (Transporter, Vehicle, Driver name/phone, Pickup date), Badge Accepted. [Mark dispatched] enabled.
- No request: Alert warning "Transport not arranged. Waiting for the distributor to request a transporter." [Mark dispatched] disabled, reason text under button (not tooltip only).
- REQUESTED: Alert "Waiting for Meena Transports to accept." disabled. REJECTED/CANCELLED: "Waiting for the distributor to arrange new transport." disabled.
List row action [Mark dispatched] is disabled with same short text "Transport not arranged"; shows "Transport ready" Badge when ACCEPTED.
Dispatch Dialog (replaces old): Dispatch date* (default today, min PO placed date, max today); Vehicle, Driver name, Driver phone = read-only prefilled fields with lock icon and helper "From accepted transport request"; no free text. Helper "Whole PO is dispatched at once". [Confirm dispatch]. 409 "transport not arranged" -> Alert in dialog, panel refreshes. Pre-V22 dispatched POs render legacy vehicle/phone text without transporter.

### Customer transport card  (/customer/orders/[id])  [T5]
Read-only TransportCard under timeline once PO(s) exist:
- Request ACCEPTED or dispatched: "Transport: Meena Transports | Vehicle TS09AB1234 | Driver Ravi 98765 43210 | Pickup 8 Nov | [Arranged]" (Dispatched order: badge Dispatched). Driver phone is tel: link.
- None or REQUESTED: muted "Transport being arranged". REJECTED/CANCELLED details never shown (same muted text).
Multi-PO order: one card line group per PO, labelled by provider ("Anjani 10 t"). No actions, no edit.

### A11y and responsive (V22)
Mobile first: cards <768, Dialog -> Sheet; all buttons >=44px; Accept/Reject side by side 50% each. Every flag/badge has icon + text. Dialog fields labelled, errors aria-describedby + role=alert; disabled dispatch exposes reason text via aria-describedby; vehicle/phone fields use inputmode (text/tel) and autocomplete off; focus returns to the triggering card after Accept/Reject; status changes announced via toast role=status.
