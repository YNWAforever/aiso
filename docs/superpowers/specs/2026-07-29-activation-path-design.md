# Activation Path — Design

**Date:** 2026-07-29
**Status:** Approved in conversation; revised after adversarial review
**Primary objective:** Make it possible for a stranger to sign up, create a brand, run a scan, and pay — with no manual database write at any point.

## 1. Context

The Supabase → Neon migration is complete and merged (PRs #36 and #37). Every runtime file
runs on `db()`, both shims are deleted, `@supabase/*` is uninstalled, and an ESLint
`no-restricted-imports` rule blocks reintroduction with no allowlist.

The code is correct. The **product** is not usable end to end, and a debugging session on
2026-07-29 established why by executing the funnel rather than reading it.

### Blocker 1 — a new signup has no entitlement

`resolveCommercialEntitlement()` grants a non-free plan through three branches: a live admin
override; `status = 'active'` **with** a non-empty `stripe_subscription_id`; or a live trial
(`trial_ends_at` in the future, **or** `status = 'trialing'` with a subscription). A fresh
account satisfies none.

The signup webhook seeds `accounts.plan = 'basic'`, but that column is Stripe-maintained
state, not entitlement — an unpaid `basic` correctly resolves to `free`, and `free` carries
`monthlyScanLimit: 0`.

The trial is the intended bridge, and only one of the two brand-creation paths grants it:

| Path | Grants trial? | Outcome |
|---|---|---|
| `POST /api/onboarding/complete` | Yes — 7 days, at route.ts:62–95 | Entitled; scans work |
| `POST /api/dashboard/clients` | **No** | Stays `free`; authenticated scans 403 |

Observed live: account `dcbd9a66` holds one brand created via the dashboard wizard and
received `403 AUTHENTICATED_SCAN_UPGRADE_REQUIRED` from `app/api/scan/route.ts`.

**Precision, because it narrows the fix:** that 403 fires only when a `clientId` the caller
owns is supplied. A signed-in free user scanning *without* a `clientId` falls through to the
public rate-limited path instead. The broken experience is specifically "scan from inside
your own brand workspace".

### Blocker 2 — no in-product path to admin

`profiles.is_admin` defaults false, and **no code anywhere writes it** — grep across `app/`,
`lib/`, `components/`, `scripts/` returns reads only. The admin console added in the
plan-override phase, which is the designed remedy for a stranded account, is therefore
unreachable in any fresh environment. Granting admin required a hand-written script against
production.

### Blocker 3 — plans are advertised as buyable when they are not

**Correction to the original draft of this spec:** it claimed checkout hands `undefined` to
Stripe. It does not. `app/api/stripe/checkout/route.ts:30–33` reads the price and guards it:

```ts
const priceId = STRIPE_PRICES[plan]
if (!priceId) {
  return NextResponse.json({ error: `Price not configured for plan: ${plan}` }, { status: 500 })
}
```

The webhook likewise does not fall through to `basic`: when `getPlanFromStripePrice` cannot
resolve a price it returns null and the webhook **400s, writing nothing**. The README's claim
that "checkout sends an undefined price id and tiers fall through to basic" is stale and
should be corrected as part of this work.

The real defects are narrower and different:

1. **The pricing page presents an unbuyable plan as buyable.** With no price configured, the
   Buy button is live and produces a 500. The Plan Catalog's own rule is that commercial
   surfaces must not promise what the runtime cannot deliver.
2. **`components/dashboard/LockedFeature.tsx` ignores `res.ok`.** It reads `data.url` and
   navigates if present; on any error response the dashboard Upgrade button is a **silent
   no-op** — no error, no state change. This is a live bug today, independent of
   configuration.
3. **The `!` assertions in `lib/stripe.ts` are a latent trap.** One consumer happens to
   check; the type says it never needs to. The next consumer will not check.

None of the three Stripe price IDs, nor `PUBLIC_SCAN_RATE_LIMIT_SECRET`, are configured.
`REPORT_SHARE_SECRET` is declared in `.env.example` but unset locally.

## 2. Goal and Definition of Done

A person with no prior access can, unaided:

```text
sign up -> create a brand -> receive a trial -> run a scan -> generate a fix pack
  -> upgrade to Pro through Stripe -> publish a client report -> open the public link
  -> revoke it -> sign out
```

**No manual database write at any point.** If any step requires one, the phase is not done.

Two specifics that make this verifiable:

- **The upgrade must be to Pro, not Basic.** `basic` has `client_reports_online: false`, so a
  Basic upgrade cannot publish a report and the run would report a false failure.
- **The environment is the Vercel project `fimmick-aeo-oitb`.** Attaching `www.fimmick.com`
  stays out of scope; "production" in this spec means that deployment.

## 3. Scope

**In:** a brand-creation service that grants the trial; preservation of the existing
onboarding rescue path; explicit trial tier; `ADMIN_EMAILS` bootstrap; honest plan
presentation and the `LockedFeature` fix; the missing configuration; the live walkthrough.

**Out:** Phase 1A monitoring; unfencing the 20 routes returning `503 FEATURE_UNAVAILABLE`;
CI and the `www.fimmick.com` domain; any change to prices, allowances, or the commercial
model; a backfill of existing accounts.

## 4. Workstream 1 — `createBrandForAccount()`

### Why a service

The defect is that **two routes own the same outcome with divergent side effects**. Adding
the rule to the dashboard route would leave it written twice — the shape that produced this
bug. A database trigger would make it unbypassable but would move the divergence somewhere
harder to see, and this codebase has already paid for a contract duplicated between PL/pgSQL
and TypeScript: `check_brand_limit()` needed a dedicated parity test to stop it drifting from
`resolveCommercialEntitlement()`.

### Interface — including the failure channel

New `lib/brands/create.ts`:

```ts
type CreateBrandResult =
  | { ok: true; clientId: string; trialEndsAt: Date }
  | { ok: false; reason: 'BRAND_LIMIT_REACHED'; plan: PlanId; limit: number }

createBrandForAccount(input: {
  accountId: string
  brandName: string
  domain?: string | null
  industry?: string | null
  region?: string | null
  description?: string | null
  competitors?: string[]
}): Promise<CreateBrandResult>
```

A discriminated union, not a thrown error and not a `NextResponse` — the service must not
know about HTTP, and callers must not guess. Database failures still throw; only the
brand-limit outcome is a value.

`trialEndsAt` is non-nullable: every account reaching a successful return has a trial, either
just granted or pre-existing. The service reads it back within the transaction rather than
inferring it from the update's `returning` clause, which yields no row when the
`where trial_started_at is null` guard does not match.

### Canonical 403 body

The two routes currently disagree: the dashboard returns `{ error, plan, limit }`, onboarding
returns `{ error }` alone. **The dashboard's richer body becomes canonical**, so onboarding's
403 gains `plan` and `limit`. This is a deliberate, breaking-ish change to onboarding's
response body and is called out here because "status codes unchanged" does not cover bodies.

### The trial rule — and its tier

`ensureTrial` sets `trial_started_at = now()` and `trial_ends_at = now() + 7 days` **only when
`trial_started_at is null`**. A second brand does not restart the clock, and an account whose
trial already expired does not receive a new one — otherwise delete-and-re-add is an unlimited
free trial.

**The trial's tier must be pinned, and currently is not.** `resolveCommercialEntitlement`
returns `activeEntitlement(account.plan, 'trial')`, so a trial inherits whatever
`accounts.plan` happens to hold. One live account carries `plan = 'enterprise'` with no
subscription and no trial; on its first brand it would receive a **7-day Enterprise trial** —
`monthlyScanLimit: null` (unmetered OpenRouter-backed scans) and `maxBrands: 10`.

Therefore `ensureTrial` also sets `plan = 'basic'` when it grants, unless the account already
holds a live Stripe subscription. The trial tier becomes a property of the grant rather than
an accident of prior state. `check_brand_limit()` mirrors the same resolution in PL/pgSQL and
needs no change, because it reads the same `plan` column.

### Atomicity, and its true boundary

The client insert, the trial grant, and the plan pin happen in **one `sql.transaction()`** —
the mechanism the signup webhook already uses.

**Acknowledged gap:** onboarding's `update scans set client_id` runs *after* this transaction
commits and returns 500 on failure, leaving a committed brand and trial with an unstamped
scan. That is the same class of partial state this section exists to prevent. It is left
outside the boundary because `sql.transaction()` is non-interactive and the scan id is
onboarding's concern, not brand creation's. The mitigation is that the stamp is idempotent
(`where client_id is null`) and retrying onboarding re-applies it.

### Preserving the onboarding rescue path

**This is the finding that most changes the design.** Onboarding grants the trial at
`route.ts:62–95`, which runs *before* the existing-client early return at `:97–125`. An
account that already has a brand can therefore self-rescue today by re-visiting
`/{lang}/onboarding` and re-submitting — the page has no `requireAuth`, so it is reachable.

Naively moving `ensureTrial` inside `createBrandForAccount` while leaving the existing-client
guard in onboarding **deletes that rescue path**, making stranding strictly worse than the
status quo.

So `ensureTrial` is also exported as `ensureTrialForAccount(accountId)` and called by
onboarding on the existing-client early-return path. The rescue survives, and the early
return keeps returning a real `trialEndsAt`.

### Required ordering in onboarding

Ambiguity here would break double-submit, because the service's allowance check would reject
an account that already holds its one permitted brand. The sequence is exact:

1. Claim the anonymous scan (if `scanId` supplied).
2. `ensureTrialForAccount(accountId)`.
3. Existing-client guard — if a brand exists, stamp `scans.client_id` and return early.
4. `createBrandForAccount(...)`.
5. Stamp `scans.client_id` with the new brand.
6. Generate seed prompts (non-fatal).

The dashboard route is simply: gate → `createBrandForAccount` → map the result to 200 or 403.

## 5. Workstream 2 — `ADMIN_EMAILS`

A server-only, comma-separated allowlist. Never `NEXT_PUBLIC_`.

1. **`app/api/webhooks/neon/route.ts`** — sets `is_admin = true` when provisioning a profile
   whose email is listed.
2. **`lib/auth.ts` `getProfile()`** — returns `is_admin: row.is_admin || emailIsListed`, so an
   existing account is promoted by configuration alone.

Deriving it in `getProfile()` keeps `profile.is_admin` truthful everywhere it is read,
including the admin console's own rendering.

**The email must be verified.** `getProfile()` sources the email from the Neon Auth session,
which also carries `emailVerified`. The derivation requires `emailVerified === true`; an
unverified claimed address must never confer admin. The webhook consumer already cross-checks
the durable `neon_auth.user` row for the same reason.

Comparison trims and lowercases. Unset or empty grants nobody — fail closed.

### Revocation is a real gap, stated as such

Consumer 1 writes `is_admin = true` **durably**. Nothing in the codebase ever writes
`is_admin = false`. Removing an email from `ADMIN_EMAILS` therefore demotes nobody who was
provisioned while listed. This is a hazard, not a mitigation, and the original draft of this
spec wrongly described it as the latter.

Given that, this phase adds a **revocation path**: the admin console gains a control to set
`is_admin = false` on a profile, guarded so an admin cannot demote themselves (which would
otherwise be a one-click lockout of the last admin). The env var remains additive; the
database remains the durable record; the console is how admin is removed.

### Preview environments

Setting `ADMIN_EMAILS` in Vercel Preview grants admin in whatever database Preview points at.
Preview currently shares Production's `DATABASE_URL`, so a Preview-scoped value is **not**
isolated. Until Preview points at its own Neon branch, `ADMIN_EMAILS` is set in Production
only. This is a configuration instruction, not an assumption.

## 6. Workstream 3 — Honest plan presentation

### Scale, corrected

Checkout's guard already exists. This workstream is therefore about **presentation and one
real client-side bug**, not about adding a missing server check.

### The type question

`STRIPE_PRICES` is annotated `StripePriceMap`, declared in the **pure** catalog as
`Record<CheckoutPlanId, string>` and also the parameter type of
`getPlanFromStripePrice(priceId, prices)`. Widening it in place would loosen the webhook's
reverse-mapping signature too.

Resolution: keep `StripePriceMap` as-is for the reverse mapping, and introduce a distinct
`ConfiguredStripePrices = Partial<Record<CheckoutPlanId, string>>` in `lib/stripe.ts` for the
environment-sourced map. The `!` assertions are dropped. A server helper derives
`purchasable: boolean` per plan.

### The pricing page

`app/[lang]/pricing/page.tsx` is a Client Component, and **three source-pinning contract tests
in `__tests__/lib/commercial-surface-contract.test.ts` assert that**, including
`useParams`/`useRouter` markers and the allowance construction living in that file. Converting
the page itself breaks them.

Therefore: the page stays a Client Component. A parent Server Component resolves
`purchasable` per plan and passes it in as a serializable prop. Only a boolean crosses the
boundary. The contract tests are updated to reflect the new prop, not deleted.

### Changes

- `POST /api/stripe/checkout` returns **503 `PLAN_UNAVAILABLE`** when the price is unset,
  replacing the current 500. A missing configuration is not an internal error.
- `LockedFeature.tsx` checks `res.ok` and surfaces a localized failure instead of silently
  doing nothing.
- The pricing card renders an unavailable state for an unpurchasable plan.

### i18n

This introduces user-facing strings: the unavailable-plan card state and the `LockedFeature`
error. Both `messages/en.json` and `messages/zh-HK.json` gain them, in concise business
Chinese rather than literal translation. There is no existing unavailable state on a plan
card — `t('coming_soon')` is used only for feature-table rows.

## 7. Workstream 4 — Configuration

`.env.example` **already exists and is tracked**, containing only `REPORT_SHARE_SECRET`. It is
**extended**, not created, to list every variable with a comment on what it gates and whether
it is required at build time. Names and descriptions only — never values.

To set in `.env.local` and in Vercel:

| Variable | Environments | Gates |
|---|---|---|
| `STRIPE_PRICE_BASIC` / `_PRO` / `_ENTERPRISE` | Production + Preview | Checkout; without them every plan is unpurchasable |
| `REPORT_SHARE_SECRET` (≥32 chars) | Production + Preview | Client report share links |
| `PUBLIC_SCAN_RATE_LIMIT_SECRET` (≥32 random chars) | Production + Preview | Public scan endpoint fails closed without it |
| `ADMIN_EMAILS` | **Production only** — see §5 | Admin bootstrap |

The README's stale claims are corrected in the same change: that no `.env.example` exists,
and that checkout sends an undefined price id.

## 8. Verification

### Test suites this work breaks — named, because they will

- `__tests__/api/dashboard-clients.test.ts` and `__tests__/api/onboarding-flow.test.ts` mock
  `sql` as a bare `vi.fn()` **with no `.transaction` property**, so the service's first
  `sql.transaction()` call throws `TypeError`. Both need the mock shape extended. They also
  queue results positionally, encoding the current query order, so the sequence changes break
  them a second time.
- `__tests__/api/onboarding.test.ts` — the narrow 400/401 smoke suite.
- `__tests__/lib/commercial-surface-contract.test.ts` — three tests pin the pricing page's
  client-component markers and allowance construction.

### Unit

Trial rule, in both directions, because it is load-bearing for revenue: first brand grants;
second does not restart; expired does not re-grant; live trial untouched; a failed insert
leaves `trial_started_at` null. **And explicitly: an account with `plan = 'enterprise'` and no
subscription receives a Basic trial, not an Enterprise one.** The obvious "first brand grants
a trial" assertion would not catch that.

Allowlist: listed grants; unlisted does not; empty grants nobody; comparison is case- and
whitespace-insensitive; **an unverified email never grants**.

Stripe: the unset-price case is a type error until handled; checkout returns 503
`PLAN_UNAVAILABLE`; an unpurchasable plan renders unavailable; `LockedFeature` surfaces a
non-ok response.

### Integration (real Neon branch)

- Atomicity: a rolled-back client insert leaves `trial_started_at` null.
- Both routes produce identical account state for an equivalent first brand.
- The onboarding rescue path: an account with a brand and no trial, re-submitting onboarding,
  ends with a live trial and no second brand.
- `check_brand_limit()` still rejects a brand over allowance; the service surfaces 403.

Mocked tests cannot satisfy the atomicity requirement. This repository has twice shipped a
green suite over code that was entirely broken in production.

### Production verification

The §2 walkthrough on `fimmick-aeo-oitb`, in both locales, as a genuinely new user, upgrading
to **Pro**.

## 9. Risks

| Risk | Mitigation |
|---|---|
| Trial rule is load-bearing for revenue in both directions | Tests for grant, non-restart, expired-no-regrant, and tier |
| The refactor could delete onboarding's working rescue path | `ensureTrialForAccount` on the early-return path; integration test for it |
| A trial inheriting `plan='enterprise'` grants unmetered scans | `ensureTrial` pins `plan='basic'` on grant; explicit test |
| `ADMIN_EMAILS` grants durably and never revokes | Console revocation control, self-demotion guarded; Production-only until Preview has its own branch |
| Non-atomic creation reproduces this phase's own bug | One transaction, proven on a real branch |
| An expiring admin override re-strands the account it rescued | Out of scope here; noted for the operations phase |

## 10. Open item carried forward

`CLAUDE.md` still states `027` is the sole pending migration and does not mention `029`. Both
are applied. The file is corrected as part of this phase's documentation change, alongside the
README items in §7.

## 11. Acceptance Outcome

The phase succeeds when a person with no prior access can become a paying Pro customer
without anyone touching the database on their behalf, and when the walkthrough outstanding
since the migration began has been performed start to finish in both supported locales.
