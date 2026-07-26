# Critical Path to Production — Design

**Date:** 2026-07-26
**Status:** Approved in conversation
**Primary objective:** Make the authenticated Fimmick AISO product genuinely work in production for one paying customer, by finishing the Supabase→Neon migration along the customer funnel and proving each step live.

## 1. Context

The repository has run ahead of its own data layer. Phase 0 (the typed Plan Catalog),
Phase 1B (the Pro client report workflow), a security-hardening pass, and admin plan
overrides have all landed. None of it can serve a customer, because roughly 38 runtime
files still import `lib/supabase.ts` or `lib/supabase-server.ts`, whose project was
deleted and whose hostname no longer resolves.

Verified against the Neon database on 2026-07-26:

| Fact | Value |
|---|---|
| `clients` rows | **0** — no brand has ever been created |
| `accounts` / `profiles` / `scans` rows | 4 / 3 / 28 — the scans are anonymous funnel traffic |
| Migration `027` (client reports) | **Not applied.** `client_reports`, `client_report_versions`, `account_report_branding` and 7 supporting functions are absent |
| Migrations `021`, `023`–`026`, `028` | Applied. Local Trust tables and the account override columns exist |
| `acquire_stripe_subscription_lease`, `apply_stripe_account_event`, `release_stripe_subscription_lease` | All present in Neon |

Two consequences follow. First, the Pro client report feature — the last phase's
headline deliverable — is broken on three independent axes: a dead database client,
missing tables, and missing functions. Second, because no brand has ever been created,
there is no production data to migrate carefully and no user to disappoint. The
migration risk is unusually low right now, and it will only grow.

Three findings from this session's exploration shape the work:

- **Sign-out is a 404, not merely broken.** `DashboardSidebar` links to `/auth/logout`,
  which does not exist; next-intl's `localePrefix: 'always'` rewrites it to
  `/en/auth/logout`, which also does not exist. The only `signOut()` implementation
  lives in `components/dashboard/Sidebar.tsx`, which **no file imports**.
- **Several routes are half-migrated.** PR #34's auth-gating pass added Neon
  `getProfile()` to `app/api/scan/route.ts`, `app/api/fix/*`, and `app/api/pulse/*`
  while leaving their data reads on Supabase, so those files import both clients.
- **`app/[lang]/dashboard/page.tsx` and `layout.tsx` already run on Neon.** A user can
  sign in and reach an empty dashboard. The first thing that fails is the Add Brand
  button, which is precisely why `clients` holds zero rows.

## 2. Goal and Definition of Done

At the end of this phase a person can, on `fimmick-aeo-oitb.vercel.app`:

```text
sign up
  -> create a brand
  -> run a scan
  -> view results
  -> generate an AI fix pack
  -> upgrade to Pro through Stripe
  -> publish a client report
  -> open the public report link
  -> revoke it
  -> sign out
```

Every step is proven by executing it against the deployed application. A passing test
suite is not evidence; this codebase has twice shipped a green suite over code that was
entirely broken in production.

The concrete milestone: `clients` moves from 0 rows to holding a real brand created by
Willy as customer zero.

## 3. Scope

### In scope

- The fourteen files this phase migrates, creates, or corrects (Section 5).
- Migration `027`, applied reproducibly.
- A migration runner and a Neon-branch integration test harness.
- Honest `503` responses for every feature not on the funnel.
- One production deployment to `fimmick-aeo-oitb`.

### Out of scope

- Phase 1A monitoring: schedules, portfolio view, period comparison, monitoring health.
- Phase 2 Enterprise: white-label, PDF, cross-brand comparison, CSV export.
- Attaching `www.fimmick.com`. Its Vercel project sits under an account that has not been
  located; this remains Willy's separate task and is not a blocker for this phase.
- Continuous integration. Build, lint, and test remain local gates by explicit decision.
- Any new feature work. If the funnel works and more is wanted, that is the next phase.

## 4. Migration Rules

Every slice observes these. They exist because each one has already caused a production
bug in this repository.

1. **`db()` tagged templates only.** `sql(someString)` throws
   `"This function can now be called only as a tagged-template function"`, whose message
   reads like a missing table. Interpolations are parameterised, not concatenated.
2. **`account_id` comes from the session, never from the request.** RLS is enabled on 22
   of 27 public tables but is inert: the application connects as `neondb_owner`
   (`rolbypassrls = true`) and no table sets FORCE ROW LEVEL SECURITY, so
   `row_security_active()` is false everywhere. Explicit filtering is the only tenant
   boundary that exists.
3. **Neon throws where `supabase-js` resolved `{ data, error }`.** Every migrated handler
   wraps its database work in `try`/`catch` and returns 5xx on failure. This is a
   deliberate behaviour change: routes that previously returned HTTP 200 over a dead
   database now fail loudly, and their tests must assert the 5xx.
4. **`supabase.rpc(name, args)` becomes `select * from name(${…})`.** The RPC form passes
   arguments by name; SQL passes them by position. Silent mis-ordering is the most likely
   way to break the Stripe webhook, so each function receives a direct integration test
   asserting its effect on the database.
5. **No file ends this phase importing both clients.** Every half-migrated file either
   finishes its migration or is fenced.
6. **Do not print connection strings.** The `@neondatabase/serverless` driver echoes the
   full URL, password included, in error messages. Pipe scripted output through
   `2>&1 | grep -v "postgresql://"`.

## 5. Slices

Work proceeds in the order a customer encounters it. Each slice is a separate branch and
pull request, deployed and verified live before the next begins.

### Slice 0 — Harness and fence

**Work**

- `scripts/migrate.ts` — applies `supabase/migrations/*.sql` in filename order against a
  target `DATABASE_URL`, recording each filename in a `schema_migrations` ledger table.
  Supports a dry-run mode that reports what it would apply without applying it.
- Neon-branch test harness: create an ephemeral branch, run the migration runner against
  it, run integration tests, drop the branch.
- Fence every out-of-scope route (Section 6).
- Delete `components/dashboard/Sidebar.tsx` and `components/dashboard/TopBar.tsx` — both
  orphaned.
- Port `scripts/seed-packs.ts` to `db()` (43 lines, trivial).

**Proof:** `npm test` provisions a fresh Neon branch, applies all migrations including
`027` cleanly, and runs green. Fenced routes return `503`. No dashboard navigation entry
points at a fenced feature.

### Slice 1 — Get in and out

**Work**

- Create `app/[lang]/auth/logout/page.tsx`, signing out through the Neon Auth browser
  client (`authClient` in `lib/auth-client.ts`) and redirecting to the localised login page.
- Correct the `DashboardSidebar` link to carry the `[lang]` prefix.

**Proof:** on the deployed application, sign in, sign out, and sign in again.

### Slice 2 — Create a brand

**Work**

- `app/api/dashboard/clients/route.ts` → `db()`. Both the brand-count check and the
  insert, preserving the existing `BRAND_LIMIT_REACHED` contract for the race the
  `check_brand_limit()` trigger catches.

**Proof:** `clients` leaves zero rows. The plan cap is enforced twice — once by
`resolveCommercialEntitlement` in the handler and once by the database trigger — and a
concurrent request at the cap still receives `403 BRAND_LIMIT_REACHED`.

### Slice 3 — Brand workspace

**Work**

- `app/[lang]/dashboard/[clientId]/page.tsx` → `db()` (10 query sites).
- `app/api/clients/[clientId]/overview/route.ts` → `db()` (8 query sites).
- `app/api/onboarding/complete/route.ts` and `app/[lang]/onboarding/page.tsx` → `db()`.

**Proof:** the workspace renders real data for the brand created in slice 2, and a fresh
signup completes onboarding without touching a fenced route.

### Slice 4 — Scan, results, and fixes

**Work**

- Finish `app/api/scan/route.ts` — remove the remaining `createServiceSupabaseClient`
  import so the file is wholly on `db()`.
- `app/[lang]/dashboard/[clientId]/result/[scanId]/page.tsx` → `db()`.
- `app/api/scans/[id]/claim/route.ts` → `db()`.
- Finish `app/api/fix/route.ts` — the `fix_packs` cache read, the scan read, and the
  insert (the ownership check already uses `db()`).

**Proof:** an authenticated scan persists a row, appears in the workspace, increments
`authenticated_scan_monthly_usage`, and produces a fix pack rendered in the Improve step.

`fix/route.ts` is on the critical path even though reports do not require it:
`lib/reports/*` has no `fix_packs` dependency, so a report publishes without it. It is
included because AI fix packs are the product's headline value and the dashboard's
Improve step, and the file is 106 lines with three call sites. The separate Pro content
tools `fix/cluster-map` and `fix/content-brief` are fenced.

### Slice 5 — Payment

**Work**

- `app/api/stripe/webhook/route.ts` → `db()`. This is a transport swap, not a rewrite:
  all three routines already exist in Neon. Each `supabase.rpc(name, args)` becomes
  `select * from name(${…})` with arguments in declared positional order.

**Proof:** replayed Stripe events upgrade the account to the correct tier; duplicate
delivery of the same event is idempotent; an out-of-order event does not regress
subscription state. Verified against the deployment, not a mock.

**Prerequisite:** real `STRIPE_PRICE_BASIC`, `STRIPE_PRICE_PRO`, and
`STRIPE_PRICE_ENTERPRISE` values. Without them checkout sends an undefined price id and
webhook tier resolution falls through to `basic`, making this slice unverifiable.

### Slice 6 — Reports

**Work**

- Apply migration `027` to production **before** deploying this slice.
- `lib/reports/store.ts` → `db()` (730 lines, the largest single file in the phase).

**Proof:** publish a report from a real scan; the public share link renders for a signed-out
visitor; revoking it returns a neutral unavailable state that leaks no metadata about
the report's existence.

**Prerequisite:** `REPORT_SHARE_SECRET`, at least 32 characters, server-only, never under a
`NEXT_PUBLIC_` name.

## 6. Fencing

A fenced route does not retain a dead implementation. Its handler loses the Supabase code
and returns `503 { error: 'FEATURE_UNAVAILABLE', feature }` from a shared
`lib/unavailable.ts` helper, carrying a comment naming the commit that holds the original
implementation. Git history is the archive. This is the only route to a clean end state,
and restoring a fenced feature later means migrating it properly rather than reviving
code against a database that no longer exists.

**Fenced (handler returns 503):**

- `app/api/pulse/onboard`, `app/api/pulse/run`, `app/api/pulse/suggest-questions`,
  `app/api/pulse/[clientId]/summary`, `app/api/pulse/[clientId]/missed`
- `app/api/fix/cluster-map`, `app/api/fix/content-brief`
- `app/api/clients/[clientId]/agents/competitors`, `…/progress`, `…/recommendations`
- `app/api/notifications`, `app/api/notifications/read-all`
- `app/api/dashboard/clients/[clientId]/alerts`
- `app/api/dashboard/clients/[clientId]/prompts`, `…/prompts/[promptId]`
- `app/api/dashboard/clients/[clientId]/local-trust/export`
- `app/api/cron/trial-emails`, `app/api/cron/evaluate-alerts`

**Fenced (page renders a localised unavailable state):**

- `app/[lang]/pulse/[clientId]/page.tsx`
- `app/[lang]/admin/authority/page.tsx`

`app/[lang]/dashboard/[clientId]/prompts/page.tsx` needs no change: it holds no data and
only redirects to `/{lang}/pulse/{clientId}#question-bank`, which renders the fenced
Pulse page's unavailable state.

**Deleted outright:**

- `components/dashboard/Sidebar.tsx`, `components/dashboard/TopBar.tsx` — orphaned
- `lib/authority/layer5-dynamic.ts` — `computeAuthority()` wires layers 1–4 only and no
  caller supplies the optional layer-5 argument
- `lib/localTrust/store.ts` — orphaned once its routes are fenced
- `lib/supabase.ts`, `lib/supabase-server.ts` — once the last consumer is gone

**Configuration:** the `/api/cron/trial-emails` entry is removed from `vercel.json`, so
the daily 09:00 job stops firing into a fenced route.

**Navigation:** the `monitor` and `roi` steps and both Pulse links are removed from
`DashboardSidebar`. The `improve` step remains, since `fix/route.ts` is migrated.

**End state:** zero `@supabase/*` imports across `app/`, `lib/`, `components/`, and
`scripts/`; both `lib/supabase*.ts` shims deleted; `@supabase/supabase-js` and
`@supabase/ssr` uninstalled; and an ESLint `no-restricted-imports` rule preventing their
reintroduction.

## 7. Verification

### The migration runner

No migration runner exists today — migrations are applied by hand, so a file's existence
proves nothing about the schema. The runner is therefore a prerequisite for the test
harness rather than a convenience, and it is also how `027` reaches production: applied
reproducibly, having already run clean against throwaway branches many times.

**The production hazard, stated plainly.** Production has migrations 001–026 and 028
applied with no ledger. Pointing a fresh runner at it would attempt to re-run all of
them. Before the runner ever touches production it receives a one-time baseline that
records those migrations as applied, verified by querying `schema_migrations` and
`information_schema`, leaving exactly `027` outstanding. Test branches come first;
production only after that baseline is confirmed.

### Test layering

| Layer | Against | Purpose |
|---|---|---|
| Integration (new) | A real ephemeral Neon branch | Critical-path routes. A test here can only pass if the query actually runs |
| Existing suites (22 files mock Supabase) | Rewritten per slice | Each is ported to the branch when its file migrates, or deleted if it only tested mock plumbing |
| Pure logic | No database | Scoring, plan catalog, checks — unchanged |

If `TEST_DATABASE_URL` is absent, integration tests **fail loudly rather than skip**. A
quiet skip is indistinguishable from a pass, and that is how this situation arose.

## 8. Deployment

Deployments target the Vercel project `fimmick-aeo-oitb`, which already holds
`DATABASE_URL`, `NEON_AUTH_BASE_URL`, and `NEON_AUTH_COOKIE_SECRET` in Production and
Preview.

Environment values Willy must supply:

| Variable | Gates | Why |
|---|---|---|
| `STRIPE_PRICE_BASIC` / `_PRO` / `_ENTERPRISE` | Slice 5 | Absent from `.env.local`; without them checkout sends an undefined price id and every tier resolves to `basic` |
| `REPORT_SHARE_SECRET` | Slice 6 | Share-link HMAC; at least 32 characters, server-only |
| `PUBLIC_SCAN_RATE_LIMIT_SECRET` | Public funnel | Absent from `.env.local`; needs confirming on Vercel or public scans fail closed |

Migration `027` is applied **before** the slice 6 deployment, never after. This mirrors
the documented `028` prerequisite for the same reason: code selecting a column that does
not exist returns 500 for every signed-in request while anonymous traffic stays green, so
the public funnel smoke-tests healthy while every logged-in customer is down.

The three dead Supabase variables (`NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) and the dead
`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` are removed from `.env.local` and from the Vercel
project once the last consumer is deleted.

## 9. Acceptance

Each slice is checked live on the day it lands. The phase's final gate is one scripted
customer-zero walkthrough, performed together on the deployed application in both `en`
and `zh-HK`:

1. Sign up with a new email address; confirm the `user.created` webhook provisions an
   account and profile.
2. Create a brand; confirm the row exists and the dashboard renders it.
3. Run an authenticated scan; confirm persistence, workspace display, and quota increment.
4. Generate a fix pack from the Improve step.
5. Upgrade to Pro through Stripe checkout; confirm the webhook applies the tier.
6. Publish a client report.
7. Open the public report link while signed out.
8. Revoke the link; confirm a neutral unavailable state.
9. Sign out, and sign back in.

Any step that cannot be completed is a phase blocker, not a follow-up.

## 10. Risks

| Risk | Mitigation |
|---|---|
| The migration runner re-runs applied migrations against production | Ledger baseline verified by query, dry-run mode, and test-branch-first sequencing |
| Stripe RPC arguments become positional and are silently mis-ordered | A direct integration test per function asserting its effect on the database |
| Migration `027` is ~830 lines and 7 functions, entirely unproven against a live database | The harness exercises it from slice 0 onward, long before production |
| Fenced features are quietly forgotten | Section 11 is an explicit register carried forward |
| A migrated route's rewritten test still passes without touching Postgres | Integration tests run against a real branch; absent `TEST_DATABASE_URL` they fail rather than skip |

## 11. Follow-up Register

Deferred by this phase, recorded so nothing is lost:

| Feature | State after this phase | Needs |
|---|---|---|
| Pulse (weekly AI monitoring) | Fenced, 503 | Migration to `db()`; it is also the natural home of Phase 1A monitoring |
| Local Trust / ROI | Fenced, 503 | Migration to `db()`. Tables exist (`021` is applied) |
| Prompt bank editing | Fenced, 503 | Migration to `db()` |
| Agent routes (competitors, progress, recommendations) | Fenced, 503 | Migration to `db()` |
| Notifications | Fenced, 503 | Migration to `db()` |
| Alerts and `evaluate-alerts` cron | Fenced, 503; unscheduled | Migration to `db()`; the cron was scheduled by nothing already |
| Trial emails cron | Fenced, 503; removed from `vercel.json` | Migration to `db()`, then reschedule |
| Pro content tools (`cluster-map`, `content-brief`) | Fenced, 503 | Migration to `db()` |
| Authority layer 5 | Deleted | Was never wired into `computeAuthority()` |
| `www.fimmick.com` | Unchanged | Locate the owning Vercel account, or repoint DNS |
| Continuous integration | None | Declined for this phase |
| E2E specs in `tests/e2e/` | Still assume Supabase auth | Rewrite against Neon Auth |

## 12. Acceptance Outcome

This phase succeeds when the authenticated product is real: a customer can be signed up,
charged, and delivered a published client report on infrastructure that actually
responds, with every claim verified by execution rather than by a passing mock. Whatever
is built next — Phase 1A monitoring, Enterprise, or anything else — then rests on a data
layer that exists.
