# Admin plan overrides — design

**Date:** 2026-07-26
**Status:** Approved, ready for implementation planning
**Scope:** Admin account management only. Customer onboarding is a separate spec.

## Problem

Two distinct problems, both surfacing as "admin doesn't match pricing".

### 1. Admin is non-functional

`app/api/admin/clients/route.ts` and `app/[lang]/admin/authority/page.tsx` both import the
Supabase client, which points at a deleted project whose hostname no longer resolves. Admin
has exactly two functions — list accounts, change a plan — and neither works at runtime.

### 2. Plan entitlements are defined in three places

| Definition | Plans | Authority |
|---|---|---|
| `lib/plans/catalog.ts` (`PLAN_CATALOG`) | `free`, `basic`, `pro`, `enterprise` | Pricing page and `lib/tier.ts` derive from it |
| `check_brand_limit()` in migration `026` | rejects `free` as a *stored* plan | Enforces brand limits at insert time |
| `plan_features` table (3 rows) | no `free` | **Orphaned — read by zero application code** |

Admin derives from none of them. Its `<select>` hardcodes three `<option>` values and its
`PATCH` validates against a hardcoded `['basic','pro','enterprise']` array, so an admin
cannot set `free` at all, and both drift silently whenever the catalog changes.

The brand limits in `PLAN_CATALOG` (1/1/3/10) and in the SQL trigger (1/1/3/10) agree
*today*. Nothing enforces that. The existing guard,
`__tests__/db/brand-limit-entitlement.test.ts`, asserts the migration text contains
"one/three/ten" — hardcoding the numbers a third time rather than comparing against the
catalog, so it passes while the catalog and SQL diverge.

### 3. Manual plan changes cannot survive Stripe

The Stripe webhook does `update accounts set plan = …, status = … where
stripe_subscription_id = …`. Admin writes `accounts.plan` directly. Any manual change is
silently overwritten by the next subscription event. There is no override column today.

Worse, `check_brand_limit()` computes `effective_plan` requiring `has_subscription` for an
active paid plan. A comped account has no Stripe subscription, so it resolves to `free`
with a brand limit of 1 — meaning a TypeScript-only override would silently fail at the
database layer.

## Decisions

1. **Admin first**, as its own spec. Onboarding follows separately.
2. **Comps are an explicit override** that survives Stripe, not a raw write to `plan`.
3. **The trigger honours the override**, and a catalog-parity test replaces the hardcoded
   limit assertions. The orphaned `plan_features` table is dropped.
4. **Admin renders the catalog** rather than restating it: accounts, effective entitlement,
   and override controls.

Rejected: an append-only `account_plan_overrides` audit table (YAGNI — needs a correlated
subquery inside a hot trigger path that already holds an advisory lock, for history nobody
has requested); and collapsing trials and comps into one `granted_plan` mechanism
(conceptually cleaner but rewrites live billing behaviour that migration 026, the Stripe
webhook, and `lib/trial.ts` all depend on).

## Data model

Migration `028_account_plan_overrides.sql` (027 is current):

```sql
alter table public.accounts
  add column if not exists override_plan       text,
  add column if not exists override_reason     text,
  add column if not exists override_set_by     uuid references public.profiles(id),
  add column if not exists override_expires_at timestamptz;

alter table public.accounts
  add constraint accounts_override_plan_check
    check (override_plan is null or override_plan in ('free','basic','pro','enterprise')),
  add constraint accounts_override_complete
    check (override_plan is null
           or (override_reason is not null and override_set_by is not null));

drop table if exists public.plan_features;
```

`override_expires_at IS NULL` means a permanent comp (internal and partner accounts). The
second constraint makes an unattributed comp impossible at the database level — a grant
cannot exist without a reason and a person.

## The resolution contract

The one thing both layers must implement identically:

```
1. override_plan set AND (override_expires_at is null OR override_expires_at > now())
       → effective_plan = override_plan            ← new branch, evaluated FIRST
2. otherwise, today's logic unchanged:
       past_due | cancelled                        → free
       active AND has_subscription                 → stored_plan
       trial live OR (trialing AND subscription)   → stored_plan
       else                                        → free
```

The override branch must be **first**. It short-circuits the `has_subscription` check that
would otherwise resolve a comped, non-paying account to `free`.

This also sidesteps the trigger's "stored plan must be basic/pro/enterprise" guard: we never
write `free` into `accounts.plan`. A downgrade comp is `override_plan = 'free'`, handled
before that validation runs.

`accounts.plan` keeps exactly two writers, and admin stops being one of them: the signup
webhook seeds it (`app/api/webhooks/neon/route.ts` inserts `'basic'`), and the Stripe
webhook maintains it thereafter.

**The override branch also skips the stored-plan validation.** Today the trigger raises
`ACCOUNT_ENTITLEMENT_INVALID` when `plan` or `status` is malformed, *before* computing the
effective plan. When a live override exists, that validation is skipped — the override fully
determines entitlement, and an account with broken Stripe state is precisely the case where
a comp is most needed. Without a live override the validation runs unchanged.

**Implementations:**
- `resolveCommercialEntitlement()` in `lib/tier.ts` gains the override branch and returns
  `getPlanDefinition(override_plan).features`.
- `check_brand_limit()` is replaced in migration `028`, reading the four columns and taking
  the override branch before its `has_subscription` case.

## Components

### `app/api/admin/clients/route.ts` (migrated to Neon)

**`GET`** — accounts joined with profiles, plus the **effective entitlement computed
server-side** via `resolveCommercialEntitlement()`. The client must not reimplement
resolution; that would create a fourth definition of the thing this spec consolidates.

**`PATCH`** — no longer writes `accounts.plan`. Two actions:

```
{ accountId, action: 'grant',  plan, reason, expiresAt? }
{ accountId, action: 'revoke' }
```

`plan` is validated against `PLAN_IDS` from the catalog, not a hardcoded array — this is what
lets an admin grant `free` and keeps the endpoint correct as the catalog evolves.
`override_set_by` comes from the authenticated admin's own profile, never the request body.
Revoke nulls all four columns.

`expiresAt` is an ISO-8601 timestamp string, or omitted for a permanent comp. A value in the
past is rejected with 400 rather than stored — storing an already-expired override would be
a silent no-op that reads as success in the UI.

### `app/admin/page.tsx`

The `<select>` is driven by `PLAN_IDS`, so it cannot drift from pricing. Each row shows the
**Stripe-derived** plan and status, the **effective** plan, and — when they differ — a badge
with the reason, who granted it, and its expiry. Beneath that, the entitlement the catalog
actually grants (`max_brands`, `history_weeks`, key feature flags).

The page is 81 lines today and this roughly doubles it, so extract
`components/admin/AccountRow.tsx` and `components/admin/OverrideControls.tsx`, leaving
`page.tsx` as fetch-and-map.

## Error handling

Every database call is checked, and a failure returns 5xx rather than a misleading success.
This is a direct response to two bugs found in this codebase: `supabase-js` resolves to
`{ data, error }` instead of throwing, and unchecked `error` values silently bypassed the
brand limit in `/api/dashboard/clients` and dropped paid upgrades in the Stripe webhook.

- Non-admin → 403.
- Plan outside `PLAN_IDS` → 400 naming the valid set.
- Missing reason → 400, mirroring the DB constraint so the user gets a real message rather
  than a constraint violation.
- An expired override simply stops matching branch 1 and the account falls back to its
  Stripe-derived plan. No cleanup job is needed.
- If the two layers ever disagree, the database is authoritative and fails closed, because
  it holds the advisory lock.

## Testing

| Test | Asserts |
|---|---|
| `__tests__/api/admin-clients.test.ts` | non-admin → 403; grant writes the override with `set_by` from the session and never touches `accounts.plan`; revoke clears all four columns; plan outside `PLAN_IDS` → 400; missing reason → 400; past `expiresAt` → 400; DB failure → 5xx |
| `__tests__/lib/entitlement-override.test.ts` | live override beats the Stripe plan; **override beats `has_subscription`** (the comp case); expired override ignored; `null` expiry is permanent |
| `__tests__/db/brand-limit-entitlement.test.ts` | rewritten to derive expected limits from `PLAN_CATALOG` rather than hardcoding them, and to cover the trigger's new override branch |

The parity test must fail with both values named when `PLAN_CATALOG.maxBrands` and the
migration SQL disagree.

## Out of scope

- `app/[lang]/admin/authority/page.tsx` and `/api/authority/override` remain on the dead
  Supabase client — separate spec.
- Customer onboarding review — separate spec, to follow.
- Comp **history**. Only the current grant is retained; re-granting overwrites the prior
  reason.
- The wider 30-file Supabase→Neon migration.
