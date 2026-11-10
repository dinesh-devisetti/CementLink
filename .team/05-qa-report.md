## HANDOFF (QA V1 re-run)
Result: PASS. F1-F11 verified; no blocking bugs. Nothing committed; no production code changed.
Suites: lint clean, typecheck clean, vitest 89/89 (87 dev + 2 new QA), playwright 3/3 (--workers=1).
Coverage (src/server + src/lib): 93.27% stmts, 91.17% branch, 88.88% funcs, 94.53% lines (gate 80%). Lowest: services/users.ts 80.5%.
Spot-checks: 20 concurrent bad logins -> <=5 are 401, rest 429 PASS; rotating spoofed XFF/x-real-ip with TRUST_PROXY=false cannot evade email limit PASS; clientIp ignores XFF, reads x-real-ip only when trusted PASS; register 201,201,429 with TRUST_PROXY=true PASS; prod without APP_URL / PAYMENT_GATEWAY throws PASS; fake gateway / insecure cookie in prod rejected without E2E=1, and with VERCEL PASS; Retry-After > 0 on 429 PASS.
Tests added: tests/integration/qa-v1-recheck.test.ts (2 cases).
Remaining (non-blocking): R1 [low] with TRUST_PROXY=false register has no limit at all (by design; must be true on Vercel, .env.example still unverified, user must add REGISTER_MAX_PER_HOUR=5, TRUST_PROXY). R2 [info] known: email lockout DoS (B3), 409 enumeration (B4), L6/L10 deferred; cross-role API 403 over HTTP to re-verify in V2.
Next: security-reviewer re-check, then V2.

## HANDOFF (QA V1)
Result: FAIL (conditional) - no functional blockers, but coverage gate not met (74.05% stmts / 74.21% lines vs 80% target in arch s8).
Suites: lint clean, typecheck clean, vitest 66/66 (30 dev + 36 QA edge), playwright 3/3.
B1 [medium] coverage 74% < 80%: guards.ts, http.ts, client.ts at 0-33% (only exercised by e2e, which v8 does not count). Fix: route-handler/guard integration tests, or scope coverage to what is unit-testable and document it.
B2 [low] 429 message says "try again in a minute" but window is 15 min (LOGIN_WINDOW_MINUTES); no Retry-After header. src/server/services/users.ts authenticate.
B3 [low] Email-keyed limit lets anyone lock out a known account (incl. admin) with 5 bad logins per window; IP key trusts spoofable X-Forwarded-For (src/server/auth/http.ts clientIp). Acceptable for MVP, record as known risk.
B4 [low] Duplicate register returns 409 (account enumeration); dev already noted.
B5 [info] No role-specific API exists yet, so cross-role API 403 (requireRole) is only unit-tested via decideApi; re-verify over HTTP in V2 (admin approve/reject).
Next: fullstack-developer (B1, B2) then re-QA; B3-B5 can ship.

## QA S1 (V1 portion): FAIL (coverage only)
| Criterion | Result | Evidence |
|-----------|--------|----------|
| Customer registers, logs in immediately, sees Customer dashboard | PASS | e2e test 1; curl register 201 ACTIVE, login redirectTo /customer |
| Distributor/Provider unapproved -> pending page, no actions | PASS | curl: login redirectTo /pending, GET /distributor -> 307 /pending; e2e test 3 |
| Admin approve/reject changes status | NOT IN V1 | belongs to V2 |
| Role X opening other role's URL -> denied | PASS (pages) | customer GET /admin, /provider, /pending -> 307 /customer; anonymous -> 307 /login. API role guard unit-tested only (B5) |
| Seeded admin logs in -> Admin dashboard | PASS | e2e test 3; seed script output "admin created" |
| Register as ADMIN | PASS | 400 VALIDATION on role; extra fields rejected (.strict) |
| Bad/garbage cookie | PASS | /api/me 401; /admin 307 /login; empty cookie handled |
| Expired session | PASS | integration test "stores only the token hash, resolves, expires, and deletes"; logout invalidates token server-side (401 after) |
| Rate limit | PASS | 5x401 then 429 by email and by IP; right password also 429 in window; resets next window (test) |
| CSRF origin | PASS | missing Origin and evil Origin -> 403 BAD_ORIGIN |
| Malformed JSON / 300-char password | PASS | 400 BAD_JSON / 400 VALIDATION |
| rzp_live_ rejected at boot | PASS | tests/unit/qa-edge.test.ts (also uppercase, leading space, production+razorpay, localhost.evil.com / localhost@evil.com not treated as local) |
| Tonnes not whole bags | PASS | 0.03, 1.01, 0.07, 2.5.1, -1, "", 1e3, 0, 1,5 all rejected; 0.05->1, 1.5->30, 2.25->45 |
| Money parsing | PASS | 385.505, -1, 1e2, .5, 5., 1,000 rejected; 0.29->29, 385.5->38550 (no float error) |
| XSS in name | PASS (stored raw, React escapes) | register accepted; verify render in V2 admin list |
| Case-insensitive duplicate email | PASS | C@X.com after c@x.com -> 409 |
| Coverage >= 80% | FAIL | 74.05% stmts, 77.34% branch, 68.88% funcs, 74.21% lines (B1) |
Tests added: tests/unit/qa-edge.test.ts (36 cases). No production code changed.

## Review V1 (lead-appended: code-reviewer + security-reviewer)
Code review: CHANGES REQUESTED (1 HIGH, 8 MED, 9 LOW). Security: APPROVE WITH CHANGES (0 CRIT, 4 MED).
### Fix loop 1 - MUST fix
F1 [HIGH] Coverage >=80%: route-handler + guard integration tests (mock next/headers, test DB): BAD_ORIGIN 403 missing/foreign Origin, BAD_JSON 400, VALIDATION 400 w/ fields, requireRole 401/403/PENDING, login cookie flags, handleError 500.
F2 [MED] Rate-limit race (services/users.ts:64-74): reserve attempt atomically before argon2 (upsert count+1 RETURNING count; >max -> 429). Test: 20 concurrent bad logins -> <=5 are 401.
F3 [MED] clientIp trusts XFF[0] (auth/http.ts:25): add TRUST_PROXY config; on Vercel use x-real-ip; never leftmost XFF. Avoid single "unknown" bucket where possible.
F4 [MED] Register has no rate limit (api/auth/register): reuse limiter keyed reg-ip:<ip> (e.g. 5/hour); duplicate path pays same hash cost. Record 409 enumeration as accepted trade-off in 03-architecture.md.
F5 [MED] Prod config (config.ts): in production APP_URL + PAYMENT_GATEWAY required (no defaults); fake gateway and COOKIE_SECURE=false allowed only with explicit E2E=1 (set by playwright.config.ts), never inferred from hostname, refused when VERCEL set.
F6 [MED] Login does not delete prior session from existing cookie (api/auth/login/route.ts:24): deleteSession(old) before createSession.
F7 [MED] scripts/seed.ts + migrate.ts read raw env: validate via zod (admin pw min 10), catch -> exit 1.
F8 [MED] login-form/register-form: branch on body.code (RATE_LIMITED, BAD_CREDENTIALS, VALIDATION, generic); guard res.json() parse.
F9 [MED] logout-button: try/finally; on !res.ok show error, don't redirect.
F10 [MED] tests/integration/auth.test.ts rate-limit test order-dependent: unique email/IP per test; exactly max BAD_CREDENTIALS then RATE_LIMITED; IP-only trip test.
F11 [LOW, cheap] 429 message uses real window + Retry-After header (QA B2).
### Should fix if cheap (else defer to V2)
L1 move AppError to src/server/errors.ts. L2 SESSION_COOKIE + ROLES in edge-safe src/lib module (dedupe). L3 guard returns narrowed actor (drop casts). L4 lazy DUMMY_HASH. L5 sessions.expires_at index + purge old login_attempts. L6 REJECTED users refused at login (403 REJECTED). L7 logout clear-cookie uses shared cookie options. L8 service-level ADMIN role refusal. L9 libsql unique error by code not string. L10 zod4 z.email().
### Accepted / deferred
No reset-on-success (keep). Fixed-window 2x boundary (accept). Origin check opt-in per handler -> consider withAuth wrapper in V2. Email lockout DoS (accept MVP, known risk).
### Open for user
.env.example contents not verified (reviewer + lead denied read). User to confirm placeholders only before commit.

## Security re-check V1 (lead-appended)
5/5 original MEDIUM FIXED. Migration 0001 SAFE. Verdict: APPROVE WITH CHANGES.
### Fix loop 2 - MUST fix
N1 [MED] users.ts:83 releaseAttempts refunds ip: key on success -> attacker w/ own account alternates bad guesses + own good login = unlimited spraying from one IP. Fix: refund only email: key, never ip:. Test: same IP, 5 bad logins on victim emails + 1 good login on own account -> next bad login is 429.
N2 [LOW-MED] TRUST_PROXY=false default silently disables IP + register limits. Fix: config superRefine requires TRUST_PROXY=true when VERCEL is set. Test it.
### Accepted (recorded in 03-architecture.md s4)
N3 denied requests still count toward email key; N4 fixed-window 2x burst; N5 E2E=1 opt-in on non-Vercel hosts.

## QA V2 (S1 rest: admin approval + access gate): PASS
| Criterion | Result | Evidence |
|-----------|--------|----------|
| Pending list shows distributors/providers only, no hashes | PASS | admin-users.test, qa-v2 "list never leaks" |
| Approve/reject changes status; access (or block) on next login | PASS | admin-routes.test, e2e test 4 (3 of 4 runs green, see B1) |
| Approve/reject deletes sessions (old cookie -> 401) | PASS | qa-v2 "revoke ACTIVE kills old cookie" |
| Rejected login -> /pending "not approved", role pages redirect | PASS | e2e test 4, routes.test requireRolePage |
| Cross-role API 403, pending/rejected 403 PENDING, anon 401, no self-approve | PASS | qa-v2 (rejected, self-approve), admin-routes |
| Unknown id 404; ADMIN/CUSTOMER target 409; injection/5000-char ids 404 | PASS | qa-v2 |
| Bad/missing Origin on POST 403, GET unaffected | PASS | qa-v2 |
| Double approve idempotent; REJECTED re-approvable | PASS | qa-v2, admin-users.test |
| Seeded admin sees Admin dashboard | PASS | e2e |
Results: lint clean, typecheck clean, 115 vitest passing (added tests/integration/qa-v2.test.ts, 6 cases), coverage 94.0% stmts / 95.2% lines, playwright 4/4 on reruns.
Bugs:
- B1 [low, test-only, flaky] tests/e2e/auth.spec.ts:104 `getByText("Your account was not approved")` hit a strict-mode violation (h1 AND Next's `#__next-route-announcer__` both match) on the first run; passed on 2 reruns. Fix: use `getByRole("heading", {name: ...})`. Not a production bug.
- Notes (accepted gaps per dev): no audit trail of approver, no pagination, no approval email; admin can revoke an ACTIVE user, which kills their sessions.
HANDOFF V2 QA: PASS (one flaky e2e locator, B1, fix before CI). Next: devops-engineer after fullstack-developer fixes B1 locator.

## Review V2 (code-reviewer + security-reviewer, lead summary)
No CRITICAL/HIGH. QA PASS (115 tests, 94% cov, e2e 4/4 after 1 flake).
Must-fix (fix loop 1, user-approved 2026-11-03):
- F1 admin-users.ts:48-58 status UPDATE + session DELETE in one db.transaction; lookup inside tx.
- F2 with-auth.ts:23-28 checkOrigin/requireRole inside try -> JSON INTERNAL 500.
- F3 list paging: zod page/limit<=50 on GET /api/admin/users, return total count; UI shows count.
- F4 validate :id format early (400/404) on approve/reject.
- F5 drop phone from AdminUserRow list projection.
- F6 approve: no session delete (no-op if already ACTIVE); reject still deletes sessions.
- F7 e2e auth.spec.ts:104 use getByRole("heading", ...) (flake B1).
- F8 tests: withAuth JSON 500 on throw; GET skips Origin; F3/F4/F6 behaviour.
- L2/L3 types: PendingRow -> Pick<AdminUserRow>; role uses schema Role type.
Decisions: revoke (ACTIVE->REJECTED) + re-approve stay, API-only; button in V8.
Deferred: audit trail (decidedBy/decidedAt), approval email.

## QA V2 re-check: PASS
| Fix | Result | Evidence |
|-----|--------|----------|
| F1 tx atomic (status + session delete) | PASS | code: db.transaction in decideUser; admin-users.test rollback-via-trigger case passes |
| F2 withAuth JSON 500 INTERNAL | PASS | admin-routes.test "JSON 500 INTERNAL when origin check or session lookup throws" |
| F3 paging page>=1, limit<=50, meta | PASS | admin-routes.test: limit=51/0, page=0/abc -> 400; limit=1 pages; meta {total,page,limit} |
| F4 malformed id -> 400 VALIDATION | PASS | admin-routes.test + qa-v2 (injection, 5000-char, %00, script ids) |
| F5 phone not in list | PASS | admin-users.test not.toHaveProperty("phone") |
| F6 approve keeps sessions, reject deletes | PASS | admin-users.test; code review of decideUser |
| F7 e2e heading selector | PASS | auth.spec.ts:104; e2e 4/4 on two consecutive runs, no flake |
Results: lint clean, typecheck clean, 122 vitest passing, coverage 94.2% stmts / 95.3% lines, playwright 4/4 x2.
Bugs: none. Known gap (dev-noted): admin UI has no next-page control (first 50 only, API pages fully).
HANDOFF V2 re-check QA: PASS. Next: devops-engineer.

## QA V3: FAIL (1 medium bug; all S2 acceptance criteria PASS)
HANDOFF V3 QA (<=12 lines)
Scope: S2 customer split request (API, schema, /customer/new, e2e). No production code changed.
Result: 161 vitest pass + 1 expected-fail (B1), lint/typecheck clean, playwright chromium --workers=1 5/5.
Added: tests/integration/qa-v3.test.ts (10 cases; B1 pinned with it.fails, flip to it() after fix).
Bug: B1 [medium] concurrent double submit -> one POST returns 500 (SQLITE_BUSY). See below.
Notes: 2.55 t = 51 bags is VALID (multiple of 0.05 t); no idempotency, so a sequential double submit creates two requests (dev-noted, no cancel).
Next: fullstack-developer (fix B1), then devops-engineer.

| Criterion / edge case | Result | Evidence |
|---|---|---|
| Allocations must sum to total (under and over) | PASS | qa-v3 "sum mismatch both directions" -> 400 |
| Whole-bag rule: 2.55 t ok (51 bags); 2.53, 2.555, 2.5.0, -1, 1e1, 0 rejected | PASS | qa-v3 tonnes test |
| Past date rejected; today (IST) accepted; yesterday IST rejected | PASS | qa-v3 today/yesterday test + unit todayIst |
| Pending/rejected/provider/customer/unknown distributor id | PASS | requests.test 422 INVALID_DISTRIBUTOR, nothing saved |
| Duplicate distributor in allocations | PASS | 400, nothing saved |
| Other customer's request id -> 404; list scoped | PASS | qa-v3 + requests.test |
| Distributor/provider calling all 3 request endpoints + /api/distributors | PASS | 403 each; anon 401 |
| Pincode 5/7 digits, letters, Devanagari digits, leading space, trailing newline | PASS | all 400 |
| Huge qty (100001, 1e9, 5000 chars), neg, 0, float, non-string, bag count 1e12/-1/2.5/"5"/null | PASS | all 400 |
| Empty allocations, address >300, blank city, null/array/__proto__ body | PASS | all 400 |
| One SENT line per distributor; tonnes stored as bags | PASS | requests.test |
| 360px split flow UI, cross-customer 404 | PASS | e2e customer-request.spec.ts 5/5 |
| Concurrent double submit | FAIL | B1 |

Bugs:
- B1 [medium] Steps: signed-in customer fires two POST /api/requests simultaneously (double-click / retry). Expected: both 201 (or one deduped). Actual: one returns 500 from SQLITE_BUSY "database is locked" (stack: createRequest transaction, src/server/services/requests.ts:97). Cause: src/server/db/client.ts creates the libsql client with no busy timeout / serialization. Suggested fix: PRAGMA busy_timeout or serialize writes, plus disable the submit button while pending and consider an idempotency key. Repro: tests/integration/qa-v3.test.ts "double submit" (it.fails).
Observation (not a bug): no rate limit on POST /api/requests (dev-noted).

## Review V3 (code-reviewer + security-reviewer, lead summary)
No CRITICAL/HIGH. Fix loop 1 items:
- F1 (QA B1) concurrent POST -> SQLITE_BUSY 500: busy_timeout on client, submit disabled while pending.
- F2 (sec M1, rev M2) rate limit POST /api/requests via reserveAttempts, key req:create:<actorId>, REQUEST_MAX_PER_HOUR default 10, 429 + Retry-After.
- F3 (sec M2) readJson body cap ~16KB -> 413 PAYLOAD_TOO_LARGE (Content-Length + text length).
- F4 (rev M1) form shows unknown/nested server field errors (map allocations.* -> allocations, else generic Alert).
- F5 (rev M3) move todayIst/resolveTotalBags/QtyUnit/MAX_TOTAL_BAGS to zod-free module.
- F6 low: distributorName fallback "Distributor" (sec L3); service-level unique/sum guard (rev L1); neededBy <= today+365 (rev L4); clear stale quantity error (rev L6); control/bidi chars rejected in address/city (sec L5); tests per rev L9.
Deferred: security headers/CSP (sec L4, to V7/release), line ordering (L2), count snapshot (L3), hydration midnight (L5), id regex dedupe (L7), CHECK from enum (L8), address read audit + retention (sec L6, enforce scoping in V4).

## QA V3 re-check: PASS
HANDOFF V3 re-check (<=12 lines)
Verdict: PASS. B1 and F1-F6 verified independently; no new bugs.
Runs: npm test 180/180 twice, playwright chromium --workers=1 5/5 twice, typecheck clean, lint 0 errors (7 unused-var warnings in my test scaffolding).
Added: tests/integration/qa-v3-recheck.test.ts (7 cases); qa-v3 B1 test is now a plain it().
Race (ACTIVE check outside the batch): acceptable for MVP. Window is a few ms; impact is one SENT line to a just-revoked distributor, who cannot see it as the distributor dashboard needs ACTIVE and the customer can see the status. Revisit in V4 by filtering lines on distributor ACTIVE or re-checking at accept time.
Observations: rate limit is reserved before parsing, so invalid/413 posts also consume the 10/h quota (safe, slightly harsh for a customer fixing typos). Other routes still use interactive db.transaction (dev-noted latent contention).
Next: devops-engineer. User must add REQUEST_MAX_PER_HOUR to .env.example.

| Item | Result | Evidence |
|---|---|---|
| 1 B1 concurrent POSTs | PASS | 4 parallel POSTs -> 201 x4, 4 rows saved |
| 2 429 after limit | PASS | 6 ok, 7th 429 + Retry-After>0, invalid body also 429, other user unaffected |
| 3 413 > 16KB | PASS | real 17KB body and lying Content-Length both 413; 301-char address still 400 |
| 4 nested allocations.* in form | PASS | mapServerFields: allocations.0.bags / allocations.2.distributorId -> allocations; unknown -> general; form renders fields.allocations (new-request-form.tsx:153) |
| 5 control/bidi rejected | PASS | \n \t NUL U+202E U+2066 U+200B U+200F U+0085 U+007F U+009F rejected in address and city; Devanagari + en dash accepted |
| 6 date <= today+365 | PASS | +365 201; +366 and 9999-12-31 400 |
| 7 revoked distributor | PASS | REJECTED distributor -> 422 (sequential); mid-flight window judged acceptable |
Bugs: none.

## QA V4: PASS
HANDOFF V4 (<=12 lines)
Verdict: PASS. S3 acceptance 1-2 and data isolation verified; no bugs found.
Runs: npm test 201/201 (191 + 10 new), coverage 95.35% stmts, typecheck clean, lint 0 errors (9 warnings, unused vars in test scaffolding), playwright chromium --workers=1 6/6.
Added: tests/integration/qa-v4.test.ts (10 cases).
| Criterion | Result | Evidence |
|---|---|---|
| Lists only D's lines + demand total bags (tonnes in UI) | PASS | summary counts ACCEPTED+PAYMENT_PENDING+PAID only (35 of 5 mixed lines); empty distributor zeros; status filter/paging cannot leak d2 lines |
| Accept with price / reject, customer sees it | PASS | 385.50 -> 38550 paise, amount = qty*price; e2e customer sees status |
| Price validation | PASS | 0, -5, 0.00, 385.555, 100000.01, +5, 1,000, unicode digits, ".5", "5.", number, null, array, object, extra keys all 400; 0.01 and 100000 accepted |
| Non-SENT / foreign / unknown line | PASS | 409 for ACCEPTED, PAYMENT_PENDING, PAID, REJECTED (row unchanged); 404 other distributor |
| Concurrency | PASS | accept vs reject: one winner; 20 parallel accepts: exactly one 200, 19 x 409, amount consistent |
| Inactive distributor | PASS | PENDING/REJECTED sessions blocked (401/403); service 403 if revoked mid-way |
| No street/email/phone leaked | PASS | payload regex check clean; key list exact |
| Cross-role / anon | PASS | anon 401, customer/provider 403, bad origin 403 |
Bugs: none. Observations: no Accepted/All tabs (page shows latest 50); Reject has no confirm dialog (dev-noted).
Next: devops-engineer / V5.

## Review V4 (code-reviewer + security-reviewer): APPROVE, no CRITICAL/HIGH
- MED (sec) accept/reject routes not rate-limited -> reuse limiter keyed by actor.id (~30/min).
- MED (code) distributor-lines.tsx: single list-level error banner off-screen at 360px -> per-line error in card.
- MED (code) Reject one-tap irreversible, no confirm -> confirm step (design asks for AlertDialog).
- LOW page<=100000 deep OFFSET -> cap ~1000 or keyset; GET /api/lines no read limit.
- LOW lines.ts: DEMAND_STATUSES unused (SQL hard-codes); service skips MAX_PRICE_PAISE; 409 text shows raw "payment_pending"; idOf -> ownedBy; failTransition re-read race may mislabel 403 (harmless).
- LOW client: price parse untrimmed/no max; Accept/Cancel enabled during reject; no router.refresh on 403; DistributorLineView imported from server module -> src/lib/types.
- Test gaps: pagination page=2/page=0, route-level deactivated-session 403, admin vs accept/reject, race test serial on one connection (comment), e2e stale-tab 409 + error UI.
- Open: customer full name visible to distributor pre-accept; street address hidden (delivery may need it post-accept).

## QA V5: PASS
HANDOFF V5 (<=12 lines)
Verdict: PASS. S3 acceptance 3-5, S4 acceptance 1 (provider orders list), V4 MEDIUM fixes verified; no bugs found.
Runs: lint 0 errors (9 pre-existing warnings), typecheck clean, npm test 235/235 (221 + 14 new), coverage 95.07% stmts, playwright chromium --workers=1 7/7. Dev server on :3000 left running (one transient 500 on /login from stale compile, cleared on recompile; not an app bug).
Added: tests/integration/qa-v5.test.ts (14 cases).
| Criterion | Result | Evidence |
|---|---|---|
| PO to ACTIVE provider, total server-side, several POs | PASS | 201 PLACED; 100000 bags x Rs1,00,000 exact; 0.01 x3 = 3 paise; client totalPaise/status extra keys 400 |
| Invalid provider | PASS | PENDING/REJECTED/distributor/customer/own id/unknown -> 422; PENDING/REJECTED distributor 401/403 |
| Qty/rate bounds | PASS | qty 0,-1,1.5,"5",null,100001,1e21,NaN 400; rate 0,-1,1.234,1e3,1,000,+5,.5,5.,100000.01,unicode,non-strings 400 |
| Over-order warning math | PASS | accepted+paid 30 (SENT/REJECTED/other distributor ignored): 20->0, +20->10, +5->5; no demand -> full qty over, still 201 |
| Provider sees only own; many D -> one P | PASS | 3 distributors visible to provider, other provider empty + 404 on confirm; no email/phone leak |
| Confirm/reject only PLACED | PASS | REJECTED->confirm 409, CONFIRMED->reject 409, rows unchanged; 10 parallel mixed: one 200, nine 409 |
| Cross-role/anon | PASS | admin 403, anon 401 on all PO endpoints; distributor cannot confirm own PO (403) |
| Rate limit 429, page cap | PASS | existing pos.test covers 429 on create/decide/lines; page 1001, 0, limit 51 -> 400; page 2 remainder |
| V4 MEDIUMs (e2e) | PASS | reject confirm step, per-line error exercised in e2e 6/7 |
Bugs: none. Observations: ACTION_MAX_PER_MIN missing from .env.example (user must add; not read by QA); limit counts invalid requests; PO list has no page UI (latest 50).
Next: devops-engineer / V6.

## Review V5 (code-reviewer): APPROVE, no CRITICAL/HIGH
- MED tests/integration/pos.test.ts:174-184,275,299 rate-limit tests use real clock vs fixed 1-min bucket -> flaky at minute boundary; inject clock / vi.setSystemTime.
- MED po-manager.tsx:16-26 client qty max 999999 (server 100000), no rate cap -> reuse MAX_TOTAL_BAGS/MAX_PRICE_PAISE or shared parser.
- LOW pos.ts:69-76 inactive distributor + bad provider -> 422 not 403; check distributor first.
- LOW pos.ts:63 overOrderBags read outside txn (advisory) -> comment.
- LOW 0003 migration: add CHECK(total_paise = qty_bags * rate_per_bag_paise).
- LOW rate-limit.ts:66 action buckets purged only on login path -> purge from enforceActionLimit occasionally.
- LOW pos.test.ts:248 "race" serial on one connection -> rename or real two-client test.
- LOW pos.ts:117,125 providerSummary.confirmedBags unused -> render in V6 or drop.
- Carry-over: requests + admin-users routes still allow page<=100000; ACTION_MAX_PER_MIN missing from .env.example (user).
