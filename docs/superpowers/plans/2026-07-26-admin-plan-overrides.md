# Admin Plan Overrides Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin grant a plan comp that survives both the Stripe webhook and the database brand-limit trigger, and make the admin console render plan entitlements from `PLAN_CATALOG` instead of restating them.

**Architecture:** A live override on `accounts` (`override_plan`, `override_reason`, `override_set_by`, `override_expires_at`) becomes the **first branch** of a resolution contract implemented identically in two places — `resolveCommercialEntitlement()` in TypeScript and `check_brand_limit()` in PL/pgSQL. Evaluating it first short-circuits the `has_subscription` check that would otherwise resolve a comped, non-paying account to `free`. Admin stops writing `accounts.plan` entirely.

**Tech Stack:** Next.js 16 App Router, TypeScript, Neon Postgres via `@neondatabase/serverless` (tagged templates only), Vitest.

**Spec:** `docs/superpowers/specs/2026-07-26-admin-plan-override-design.md`

---

## Critical context for the implementer

Read these before starting. They are non-obvious and will cause silent bugs if missed.

1. **The Neon driver is tagged-template only.** ``sql`select ...` `` works; `sql('select ...')` throws `"This function can now be called only as a tagged-template function"`. Do not misread that error as a missing table.

2. **Never import `@/lib/supabase` or `@/lib/supabase-server`.** They point at a deleted project whose hostname does not resolve. `supabase-js` does **not** throw on failure — it resolves to `{ data, error }`. Unchecked `error` values have already caused two production bugs in this codebase (a bypassed brand limit and dropped Stripe upgrades). Every DB call in this plan must be in a `try/catch` and return 5xx on failure.

3. **`requireAdmin()` from `lib/auth.ts` calls `redirect()`.** It is for Server Components and layouts. In a route handler it produces a redirect, not a 403. Task 1 extracts the route-handler variant.

4. **There is no migration runner.** A migration file existing does not mean it ran. Task 8 covers applying it.

5. **`accounts.plan` has two writers and admin is not one of them after this work:** the signup webhook seeds `'basic'` (`app/api/webhooks/neon/route.ts`), and the Stripe webhook maintains it.

6. **Do not print secret values.** When scripting against the DB, pipe through `2>&1 | grep -v "postgresql://"` — the driver echoes the full connection string, password included, in its error messages.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/admin-guard.ts` **(create)** | Route-handler admin gate returning either a bail-out response or the admin's profile |
| `supabase/migrations/028_account_plan_overrides.sql` **(create)** | Override columns + constraints, `check_brand_limit()` rewrite, drop orphaned `plan_features` |
| `lib/tier.ts` **(modify)** | Override branch in `resolveCommercialEntitlement()` |
| `app/api/admin/clients/route.ts` **(modify)** | GET accounts + server-resolved entitlement; PATCH grant/revoke |
| `app/api/authority/override/route.ts` **(modify)** | Use the shared guard instead of its local copy |
| `app/admin/page.tsx` **(modify)** | Fetch-and-map container only |
| `components/admin/AccountRow.tsx` **(create)** | One account row: Stripe-derived vs effective plan, entitlement summary |
| `components/admin/OverrideControls.tsx` **(create)** | Grant/revoke form driven by `PLAN_IDS` |
| `__tests__/lib/entitlement-override.test.ts` **(create)** | TS resolution contract |
| `__tests__/api/admin-clients.test.ts` **(create)** | Admin API behaviour |
| `__tests__/db/brand-limit-entitlement.test.ts` **(rewrite)** | SQL contract + catalog parity |

`app/admin/page.tsx` is 81 lines today and this roughly doubles it, hence the two extracted components.

---

### Task 1: Shared route-handler admin guard

`app/api/authority/override/route.ts` already defines a local `requireAdmin()` that returns a `NextResponse`. The admin clients route needs the same, plus the admin's profile id for `override_set_by`. Extract it once.

**Files:**
- Create: `lib/admin-guard.ts`
- Create: `__tests__/lib/admin-guard.test.ts`
- Modify: `app/api/authority/override/route.ts:8-14` (replace local helper with the import)

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/admin-guard.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const getProfileMock = vi.fn()
vi.mock('@/lib/auth', () => ({ getProfile: () => getProfileMock() }))

async function guard() {
  const { requireApiAdmin } = await import('@/lib/admin-guard')
  return requireApiAdmin()
}

describe('requireApiAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns 401 when signed out', async () => {
    getProfileMock.mockReturnValue(null)
    const result = await guard()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(401)
  })

  it('returns 403 for a signed-in non-admin', async () => {
    getProfileMock.mockReturnValue({ id: 'p1', account_id: 'a1', is_admin: false })
    const result = await guard()
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.response.status).toBe(403)
  })

  it('returns the profile for an admin', async () => {
    getProfileMock.mockReturnValue({ id: 'p1', account_id: 'a1', is_admin: true })
    const result = await guard()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.profile.id).toBe('p1')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/lib/admin-guard.test.ts`
Expected: FAIL — `Cannot find module '@/lib/admin-guard'`

- [ ] **Step 3: Write the implementation**

Create `lib/admin-guard.ts`:

```ts
import { NextResponse } from 'next/server'
import { getProfile } from '@/lib/auth'
import type { ProfileWithAccount } from '@/lib/types'

// Route-handler flavour of requireAdmin(). lib/auth.ts's requireAdmin() calls
// redirect(), which is correct for Server Components and layouts but produces a
// redirect rather than a status code inside an API route.
export type AdminGuardResult =
  | { ok: true;  profile: ProfileWithAccount }
  | { ok: false; response: NextResponse }

export async function requireApiAdmin(): Promise<AdminGuardResult> {
  const profile = await getProfile()
  if (!profile) {
    return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) }
  }
  if (!profile.is_admin) {
    return { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) }
  }
  return { ok: true, profile }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/lib/admin-guard.test.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Use the shared guard in the authority route**

In `app/api/authority/override/route.ts`, delete the local `requireAdmin()` helper (the `async function requireAdmin() { ... }` block, roughly lines 7–14) and add to the imports:

```ts
import { requireApiAdmin } from '@/lib/admin-guard'
```

Then change each call site. The old shape was:

```ts
const denied = await requireAdmin()
if (denied) return denied
```

The new shape is:

```ts
const admin = await requireApiAdmin()
if (!admin.ok) return admin.response
```

- [ ] **Step 6: Verify the authority route still behaves identically**

Run: `npx vitest run __tests__/ --reporter=dot`
Expected: PASS, no new failures. Then `npx tsc --noEmit -p tsconfig.json` → 0 errors.

- [ ] **Step 7: Commit**

```bash
git add lib/admin-guard.ts __tests__/lib/admin-guard.test.ts app/api/authority/override/route.ts
git commit -m "refactor(admin): extract route-handler admin guard"
```

---

### Task 2: Migration 028 — override columns

The migration is built across Tasks 2 and 4; this task adds the columns, constraints, and the `plan_features` drop. Task 4 appends the trigger rewrite to the same file.

**Files:**
- Create: `supabase/migrations/028_account_plan_overrides.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/028_account_plan_overrides.sql`:

```sql
-- Admin plan comps that survive both the Stripe webhook and check_brand_limit().
--
-- accounts.plan keeps exactly two writers: the signup webhook seeds it ('basic')
-- and the Stripe webhook maintains it. Admin writes these override columns
-- instead, so a comp is no longer clobbered by the next subscription event.

alter table public.accounts
  add column if not exists override_plan       text,
  add column if not exists override_reason     text,
  add column if not exists override_set_by     uuid references public.profiles(id),
  add column if not exists override_expires_at timestamptz;

-- override_expires_at IS NULL means a permanent comp (internal/partner accounts).
alter table public.accounts
  drop constraint if exists accounts_override_plan_check;
alter table public.accounts
  add constraint accounts_override_plan_check
    check (override_plan is null
           or override_plan in ('free', 'basic', 'pro', 'enterprise'));

-- An unattributed comp is impossible at the database level: a grant cannot
-- exist without a reason and a person.
alter table public.accounts
  drop constraint if exists accounts_override_complete;
alter table public.accounts
  add constraint accounts_override_complete
    check (override_plan is null
           or (override_reason is not null and override_set_by is not null));

-- Orphaned third definition of plan entitlements: three rows, read by zero
-- application code. PLAN_CATALOG in lib/plans/catalog.ts is the source of truth.
drop table if exists public.plan_features;
```

- [ ] **Step 2: Verify the SQL parses without applying it**

The migration is applied in Task 8. For now confirm it is syntactically valid by reading it back:

Run: `grep -c "add column if not exists" supabase/migrations/028_account_plan_overrides.sql`
Expected: `4`

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/028_account_plan_overrides.sql
git commit -m "feat(db): add account plan override columns"
```

---

### Task 3: TypeScript override branch

**Files:**
- Modify: `lib/tier.ts`
- Create: `__tests__/lib/entitlement-override.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/entitlement-override.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { resolveCommercialEntitlement } from '@/lib/tier'

const NOW = new Date('2026-07-26T00:00:00Z')
const FUTURE = '2026-12-31T00:00:00Z'
const PAST = '2026-01-01T00:00:00Z'

// A comped account: no Stripe subscription at all. This is the case that fails
// without the override branch, because the paid path requires has_subscription.
const COMPED = {
  plan: 'basic', status: 'active', stripe_subscription_id: null, trial_ends_at: null,
  override_plan: 'enterprise', override_expires_at: null,
}

describe('resolveCommercialEntitlement — admin override', () => {
  it('grants the override plan to an account with no Stripe subscription', () => {
    const result = resolveCommercialEntitlement(COMPED, NOW)
    expect(result.plan).toBe('enterprise')
    expect(result.source).toBe('override')
    expect(result.features.max_brands).toBe(10)
  })

  it('beats the Stripe-derived plan on a paying account', () => {
    const result = resolveCommercialEntitlement({
      plan: 'basic', status: 'active', stripe_subscription_id: 'sub_1',
      trial_ends_at: null, override_plan: 'pro', override_expires_at: FUTURE,
    }, NOW)
    expect(result.plan).toBe('pro')
    expect(result.source).toBe('override')
  })

  it('treats a null expiry as permanent', () => {
    const result = resolveCommercialEntitlement({ ...COMPED, override_expires_at: null }, NOW)
    expect(result.plan).toBe('enterprise')
  })

  it('ignores an expired override and falls back to Stripe state', () => {
    const result = resolveCommercialEntitlement({
      plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1',
      trial_ends_at: null, override_plan: 'enterprise', override_expires_at: PAST,
    }, NOW)
    expect(result.plan).toBe('pro')
    expect(result.source).toBe('paid')
  })

  it('supports a downgrade comp to free', () => {
    const result = resolveCommercialEntitlement({
      plan: 'enterprise', status: 'active', stripe_subscription_id: 'sub_1',
      trial_ends_at: null, override_plan: 'free', override_expires_at: null,
    }, NOW)
    expect(result.plan).toBe('free')
    expect(result.source).toBe('override')
    expect(result.features.max_brands).toBe(1)
  })

  it('rescues an account whose Stripe state is malformed', () => {
    // past_due would normally force free; a live comp overrides that.
    const result = resolveCommercialEntitlement({
      plan: 'basic', status: 'past_due', stripe_subscription_id: null,
      trial_ends_at: null, override_plan: 'pro', override_expires_at: null,
    }, NOW)
    expect(result.plan).toBe('pro')
    expect(result.source).toBe('override')
  })

  it('ignores an unknown override plan', () => {
    const result = resolveCommercialEntitlement({
      plan: 'basic', status: 'active', stripe_subscription_id: 'sub_1',
      trial_ends_at: null, override_plan: 'platinum', override_expires_at: null,
    }, NOW)
    expect(result.plan).toBe('basic')
    expect(result.source).toBe('paid')
  })

  it('accepts a Date expiry, as returned by the Neon driver for timestamptz', () => {
    const result = resolveCommercialEntitlement(
      { ...COMPED, override_expires_at: new Date(FUTURE) }, NOW,
    )
    expect(result.plan).toBe('enterprise')
  })

  it('leaves accounts without an override unchanged', () => {
    const result = resolveCommercialEntitlement({
      plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1', trial_ends_at: null,
    }, NOW)
    expect(result.plan).toBe('pro')
    expect(result.source).toBe('paid')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/lib/entitlement-override.test.ts`
Expected: FAIL — the override tests report `plan` as `'basic'`/`'free'` and `source` as `'paid'`/`'past_due'`, because no override branch exists yet.

- [ ] **Step 3: Extend the account type and source union**

In `lib/tier.ts`, add `'override'` to `EntitlementSource` and the two override fields to `CommercialAccount`:

```ts
export type EntitlementSource =
  | 'free' | 'paid' | 'trial' | 'expired-trial' | 'past_due' | 'cancelled' | 'override'

export type CommercialAccount = {
  plan?: unknown
  status?: unknown
  stripe_subscription_id?: unknown
  trial_ends_at?: unknown
  override_plan?: unknown
  override_expires_at?: unknown
} | null | undefined
```

- [ ] **Step 4: Add the override resolver and a unified entitlement builder**

Still in `lib/tier.ts`, add below the existing `activeEntitlement` function:

```ts
const OVERRIDE_PLANS = new Set<EffectivePlan>(['free', 'basic', 'pro', 'enterprise'])

// Unified builder: unlike activeEntitlement/freeEntitlement it accepts any plan
// with any source, which the override branch needs (a comp can be 'free').
function entitlementFor(plan: EffectivePlan, source: EntitlementSource): CommercialEntitlement {
  const definition = PLAN_CATALOG[plan]
  return {
    plan,
    source,
    features: definition.features,
    monthlyScanLimit: definition.monthlyScanLimit,
  }
}

// Returns the override plan when one is set and unexpired, else null.
// A null expiry means permanent; a malformed expiry is ignored rather than
// treated as permanent, so a bad write fails closed.
function liveOverridePlan(account: NonNullable<CommercialAccount>, now: Date): EffectivePlan | null {
  const plan = typeof account.override_plan === 'string'
    && OVERRIDE_PLANS.has(account.override_plan as EffectivePlan)
    ? account.override_plan as EffectivePlan
    : null
  if (!plan) return null

  const raw = account.override_expires_at
  if (raw === null || raw === undefined) return plan

  const expiry = raw instanceof Date ? raw.getTime()
    : typeof raw === 'string' ? new Date(raw).getTime()
      : Number.NaN
  if (!Number.isFinite(expiry)) return null

  return expiry > now.getTime() ? plan : null
}
```

- [ ] **Step 5: Evaluate the override first in `resolveCommercialEntitlement`**

In `lib/tier.ts`, insert the override branch immediately after the `if (!account)` guard and **before** the `past_due` / `cancelled` checks:

```ts
export function resolveCommercialEntitlement(
  account: CommercialAccount,
  now: Date = new Date(),
): CommercialEntitlement {
  if (!account) return freeEntitlement('free')

  // Branch 1: a live admin override determines entitlement outright. It runs
  // BEFORE the status checks and before has_subscription, because a comped
  // account has no Stripe subscription and may have broken Stripe state —
  // which is exactly when a comp is needed.
  const overridePlan = liveOverridePlan(account, now)
  if (overridePlan) return entitlementFor(overridePlan, 'override')

  if (account.status === 'past_due') return freeEntitlement('past_due')
  if (account.status === 'cancelled') return freeEntitlement('cancelled')

  // ... rest of the function unchanged
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run __tests__/lib/entitlement-override.test.ts`
Expected: PASS, 9 tests

- [ ] **Step 7: Verify no existing entitlement behaviour regressed**

Run: `npx vitest run __tests__/lib/ __tests__/api/ --reporter=dot`
Expected: PASS, no new failures. Then `npx tsc --noEmit -p tsconfig.json` → 0 errors.

- [ ] **Step 8: Commit**

```bash
git add lib/tier.ts __tests__/lib/entitlement-override.test.ts
git commit -m "feat(tier): resolve admin plan overrides before Stripe state"
```

---

### Task 4: SQL trigger override branch + catalog parity test

The TypeScript branch alone is not enough — `check_brand_limit()` computes its own effective plan, so without this task a comp is granted in the app and then refused by the database.

**Files:**
- Modify: `supabase/migrations/028_account_plan_overrides.sql` (append)
- Rewrite: `__tests__/db/brand-limit-entitlement.test.ts`
- Modify: `README.md` (add 028 to the migration prerequisites list)

- [ ] **Step 1: Write the failing parity + contract test**

Replace the entire contents of `__tests__/db/brand-limit-entitlement.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { existsSync, readFileSync } from 'node:fs'
import { PLAN_IDS, PLAN_CATALOG } from '@/lib/plans/catalog'

// 028 supersedes 026's definition of check_brand_limit(); assertions target the
// current definition.
const migrationPath = 'supabase/migrations/028_account_plan_overrides.sql'

function migrationSql() {
  return existsSync(migrationPath) ? readFileSync(migrationPath, 'utf8') : ''
}

describe('effective brand-limit migration', () => {
  it('serializes inserts for the same account before counting brands', () => {
    expect(migrationSql()).toMatch(/pg_advisory_xact_lock/i)
  })

  it('derives entitlement from status, subscription, and trial expiry', () => {
    const sql = migrationSql()
    expect(sql).toMatch(/when\s+account_status\s+in\s*\(\s*'past_due'\s*,\s*'cancelled'\s*\)\s+then\s+'free'/i)
    expect(sql).toMatch(/when\s+account_status\s*=\s*'active'\s+and\s+has_subscription\s+then\s+stored_plan/i)
  })

  it('fails closed for missing or malformed account state', () => {
    const sql = migrationSql()
    expect(sql).toMatch(/if\s+not\s+found\s+then[\s\S]*raise\s+exception\s+'ACCOUNT_ENTITLEMENT_INVALID'/i)
    expect(sql).toMatch(/stored_plan\s+not\s+in\s*\(\s*'basic'\s*,\s*'pro'\s*,\s*'enterprise'\s*\)/i)
  })

  it('evaluates a live override before the stored-plan validation', () => {
    const sql = migrationSql()
    expect(sql).toMatch(/override_is_live/i)
    // The override branch must be assigned before the malformed-state guard runs,
    // otherwise a comp cannot rescue an account with broken Stripe state.
    const overrideAt = sql.search(/override_is_live\s*:=/i)
    const validationAt = sql.search(/account plan or status is malformed/i)
    expect(overrideAt).toBeGreaterThan(-1)
    expect(validationAt).toBeGreaterThan(-1)
    expect(overrideAt).toBeLessThan(validationAt)
  })

  it('honours a null override expiry as permanent', () => {
    expect(migrationSql()).toMatch(/override_expires_at\s+is\s+null\s+or\s+override_expires_at\s*>\s*pg_catalog\.now\(\)/i)
  })

  // The real drift guard: derived from PLAN_CATALOG, not hardcoded.
  it('keeps SQL brand limits in sync with PLAN_CATALOG', () => {
    const sql = migrationSql()
    for (const id of PLAN_IDS) {
      const expected = PLAN_CATALOG[id].maxBrands
      const match = sql.match(new RegExp(`when\\s+'${id}'\\s+then\\s+(\\d+)`, 'i'))
      expect(match, `migration must define a brand limit for '${id}'`).not.toBeNull()
      expect(
        Number(match![1]),
        `PLAN_CATALOG.${id}.maxBrands is ${expected} but ${migrationPath} says ${match![1]}`,
      ).toBe(expected)
    }
  })

  it('documents migration 028 as a release prerequisite', () => {
    expect(readFileSync('README.md', 'utf8')).toContain(migrationPath)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/db/brand-limit-entitlement.test.ts`
Expected: FAIL — 028 contains no `check_brand_limit()` definition yet, so the lock, entitlement, override, and parity assertions all fail.

- [ ] **Step 3: Append the trigger rewrite to migration 028**

Append to `supabase/migrations/028_account_plan_overrides.sql`:

```sql
-- Replaces the definition from 026. A live override is evaluated FIRST, before
-- the stored-plan validation and before has_subscription: a comped account has
-- no Stripe subscription, and an account with malformed Stripe state is exactly
-- the case a comp exists to rescue.
create or replace function public.check_brand_limit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_plan text;
  account_status text;
  stripe_subscription_id text;
  trial_ends_at timestamptz;
  override_plan text;
  override_expires_at timestamptz;
  override_is_live boolean;
  has_subscription boolean;
  trial_is_live boolean;
  effective_plan text;
  brand_limit integer;
  current_count integer;
begin
  if new.account_id is null then
    raise exception 'ACCOUNT_ENTITLEMENT_INVALID'
      using detail = 'account_id is required';
  end if;

  -- Serialize every brand insert for one account before reading account state or counting.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(new.account_id::text, 0)
  );

  select
    accounts.plan,
    accounts.status,
    accounts.stripe_subscription_id,
    accounts.trial_ends_at,
    accounts.override_plan,
    accounts.override_expires_at
  into
    stored_plan,
    account_status,
    stripe_subscription_id,
    trial_ends_at,
    override_plan,
    override_expires_at
  from public.accounts
  where accounts.id = new.account_id;

  if not found then
    raise exception 'ACCOUNT_ENTITLEMENT_INVALID'
      using detail = 'account does not exist';
  end if;

  override_is_live := override_plan is not null
    and override_plan in ('free', 'basic', 'pro', 'enterprise')
    and (override_expires_at is null or override_expires_at > pg_catalog.now());

  if override_is_live then
    effective_plan := override_plan;
  else
    if stored_plan is null
      or stored_plan not in ('basic', 'pro', 'enterprise')
      or account_status is null
      or account_status not in ('active', 'past_due', 'cancelled', 'trialing')
    then
      raise exception 'ACCOUNT_ENTITLEMENT_INVALID'
        using detail = 'account plan or status is malformed';
    end if;

    if stripe_subscription_id is not null
      and pg_catalog.btrim(stripe_subscription_id) = ''
    then
      raise exception 'ACCOUNT_ENTITLEMENT_INVALID'
        using detail = 'subscription id is malformed';
    end if;

    has_subscription := stripe_subscription_id is not null;
    trial_is_live := trial_ends_at is not null
      and trial_ends_at > pg_catalog.now();

    effective_plan := case
      when account_status in ('past_due', 'cancelled') then 'free'
      when account_status = 'active' and has_subscription then stored_plan
      when trial_is_live
        or (account_status = 'trialing' and has_subscription)
        then stored_plan
      else 'free'
    end;
  end if;

  -- Keep these in sync with PLAN_CATALOG[*].maxBrands in lib/plans/catalog.ts.
  -- __tests__/db/brand-limit-entitlement.test.ts fails if they diverge.
  brand_limit := case effective_plan
    when 'free' then 1
    when 'basic' then 1
    when 'pro' then 3
    when 'enterprise' then 10
    else null
  end;

  if brand_limit is null then
    raise exception 'ACCOUNT_ENTITLEMENT_INVALID'
      using detail = 'effective plan is malformed';
  end if;

  select count(*)
  into current_count
  from public.clients
  where clients.account_id = new.account_id;

  if current_count >= brand_limit then
    raise exception 'BRAND_LIMIT_REACHED'
      using detail = pg_catalog.format(
        'effective_plan=%s limit=%s',
        effective_plan,
        brand_limit
      );
  end if;

  return new;
end;
$$;

drop trigger if exists enforce_brand_limit on public.clients;

create trigger enforce_brand_limit
  before insert on public.clients
  for each row
  execute function public.check_brand_limit();

revoke all on function public.check_brand_limit() from public;

do $acl$
begin
  if to_regrole('anon') is not null then
    execute 'revoke all on function public.check_brand_limit() from anon';
  end if;
  if to_regrole('authenticated') is not null then
    execute 'revoke all on function public.check_brand_limit() from authenticated';
  end if;
end
$acl$;
```

- [ ] **Step 4: Add 028 to the README prerequisites**

In `README.md`, in the "Public scan deployment prerequisites" bullet list, add after the `026` line:

```markdown
- Apply `supabase/migrations/028_account_plan_overrides.sql` before using admin plan comps.
  It adds the override columns and replaces `check_brand_limit()` so a comp is honoured by
  the database as well as the application.
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run __tests__/db/brand-limit-entitlement.test.ts`
Expected: PASS, 7 tests

- [ ] **Step 6: Prove the parity test actually catches drift**

Temporarily change `pro`'s limit in the migration from `then 3` to `then 5`, re-run the test, and confirm it fails with a message naming both values:

Run: `npx vitest run __tests__/db/brand-limit-entitlement.test.ts`
Expected: FAIL — `PLAN_CATALOG.pro.maxBrands is 3 but supabase/migrations/028_account_plan_overrides.sql says 5`

Then revert `then 5` back to `then 3` and re-run to confirm PASS. A guard that has never been seen to fail is not a guard.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/028_account_plan_overrides.sql __tests__/db/brand-limit-entitlement.test.ts README.md
git commit -m "feat(db): honour plan overrides in check_brand_limit; add catalog parity test"
```

---

### Task 5: Admin API — GET accounts with resolved entitlement

**Files:**
- Modify: `app/api/admin/clients/route.ts` (GET only; PATCH in Task 6)
- Create: `__tests__/api/admin-clients.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/admin-clients.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({ db: () => sqlMock }))

const getProfileMock = vi.fn()
vi.mock('@/lib/auth', () => ({ getProfile: () => getProfileMock() }))

const ADMIN = { id: 'admin-1', account_id: 'acc-admin', is_admin: true }

function queryText(strings: unknown) {
  return Array.isArray(strings) ? (strings as string[]).join('?') : String(strings)
}

async function get() {
  const { GET } = await import('@/app/api/admin/clients/route')
  return GET()
}

describe('GET /api/admin/clients', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    getProfileMock.mockReturnValue(ADMIN)
  })

  it('returns 403 for a signed-in non-admin', async () => {
    getProfileMock.mockReturnValue({ ...ADMIN, is_admin: false })
    expect((await get()).status).toBe(403)
  })

  it('returns 401 when signed out', async () => {
    getProfileMock.mockReturnValue(null)
    expect((await get()).status).toBe(401)
  })

  it('resolves entitlement server-side, including a live override', async () => {
    sqlMock.mockResolvedValue([{
      id: 'acc-1', plan: 'basic', status: 'active',
      stripe_subscription_id: null, trial_ends_at: null,
      override_plan: 'enterprise', override_reason: 'partner', override_expires_at: null,
      override_set_by: 'admin-1', created_at: '2026-01-01T00:00:00Z',
      display_name: 'Acme', clients: [],
    }])
    const res = await get()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body[0].entitlement.plan).toBe('enterprise')
    expect(body[0].entitlement.source).toBe('override')
    expect(body[0].hasSubscription).toBe(false)
  })

  it('does not leak the raw Stripe subscription id', async () => {
    sqlMock.mockResolvedValue([{
      id: 'acc-1', plan: 'pro', status: 'active',
      stripe_subscription_id: 'sub_secret', trial_ends_at: null,
      override_plan: null, override_reason: null, override_expires_at: null,
      override_set_by: null, created_at: '2026-01-01T00:00:00Z',
      display_name: 'Acme', clients: [],
    }])
    const body = await (await get()).json()
    expect(body[0].stripe_subscription_id).toBeUndefined()
    expect(body[0].hasSubscription).toBe(true)
  })

  it('returns 5xx when the query fails rather than an empty list', async () => {
    sqlMock.mockRejectedValue(new Error('connection failed'))
    const res = await get()
    expect(res.status).toBeGreaterThanOrEqual(500)
  })

  it('queries via Neon, not the deleted Supabase project', async () => {
    sqlMock.mockResolvedValue([])
    await get()
    expect(sqlMock).toHaveBeenCalled()
    expect(queryText(sqlMock.mock.calls[0][0]).toLowerCase()).toContain('from accounts')
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/api/admin-clients.test.ts`
Expected: FAIL — the route still imports `@/lib/supabase-server`, so it errors with `supabaseUrl is required` or returns a redirect from `requireAdmin()`.

- [ ] **Step 3: Rewrite the GET handler**

Replace the top of `app/api/admin/clients/route.ts` (imports plus the whole `GET` function) with:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { requireApiAdmin } from '@/lib/admin-guard'
import { db } from '@/lib/db'
import { resolveCommercialEntitlement } from '@/lib/tier'
// Still imported only because the old PATCH below has not been replaced yet.
// Task 6 deletes this import along with that handler. Keeping it here means
// this task's commit still builds.
import { createServiceSupabaseClient } from '@/lib/supabase-server'

export const dynamic = 'force-dynamic'

type AccountQueryRow = {
  id: string
  plan: string
  status: string
  stripe_subscription_id: string | null
  trial_ends_at: string | Date | null
  override_plan: string | null
  override_reason: string | null
  override_expires_at: string | Date | null
  override_set_by: string | null
  created_at: string | Date
  display_name: string | null
  override_set_by_name: string | null
  clients: { id: string; brand_name: string; status: string }[]
}

export async function GET() {
  const admin = await requireApiAdmin()
  if (!admin.ok) return admin.response

  const sql = db()
  try {
    const rows = await sql`
      select
        a.id, a.plan, a.status, a.stripe_subscription_id, a.trial_ends_at,
        a.override_plan, a.override_reason, a.override_expires_at, a.override_set_by,
        a.created_at,
        (
          select p.display_name from profiles p
          where p.account_id = a.id
          order by p.created_at
          limit 1
        ) as display_name,
        -- Resolve the granting admin's name; override_set_by is a bare uuid and
        -- the badge has to show who issued the comp.
        (
          select p.display_name from profiles p
          where p.id = a.override_set_by
        ) as override_set_by_name,
        coalesce((
          select json_agg(json_build_object(
            'id', c.id, 'brand_name', c.brand_name, 'status', c.status
          ))
          from clients c where c.account_id = a.id
        ), '[]'::json) as clients
      from accounts a
      order by a.created_at desc
    ` as AccountQueryRow[]

    // Entitlement is resolved here, not in the client, so there is exactly one
    // resolution path in TypeScript.
    const accounts = rows.map(row => {
      const { stripe_subscription_id, ...rest } = row
      return {
        ...rest,
        hasSubscription: typeof stripe_subscription_id === 'string'
          && stripe_subscription_id.length > 0,
        entitlement: resolveCommercialEntitlement(row),
      }
    })

    return NextResponse.json(accounts)
  } catch (err) {
    console.error('[admin/clients] account query failed:', (err as Error)?.message ?? String(err))
    return NextResponse.json({ error: 'Failed to load accounts' }, { status: 500 })
  }
}
```

Leave the existing `PATCH` untouched in this task — Task 6 replaces it. With its Supabase import retained above, the file still typechecks and this commit stays green.

- [ ] **Step 4: Run the GET tests**

Run: `npx vitest run __tests__/api/admin-clients.test.ts -t "GET"`
Expected: PASS, 6 tests

- [ ] **Step 5: Verify the commit is green before committing**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 0 errors. If this reports a missing `createServiceSupabaseClient`, the import above was dropped — restore it; Task 6 removes it properly.

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/clients/route.ts __tests__/api/admin-clients.test.ts
git commit -m "feat(admin): serve accounts from Neon with resolved entitlement"
```

---

### Task 6: Admin API — PATCH grant/revoke

**Files:**
- Modify: `app/api/admin/clients/route.ts` (PATCH)
- Modify: `__tests__/api/admin-clients.test.ts` (append)

- [ ] **Step 1: Write the failing test**

Append to `__tests__/api/admin-clients.test.ts`:

```ts
import { NextRequest } from 'next/server'

function patchRequest(body: Record<string, unknown>) {
  return new NextRequest('http://localhost/api/admin/clients', {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  })
}

async function patch(body: Record<string, unknown>) {
  const { PATCH } = await import('@/app/api/admin/clients/route')
  return PATCH(patchRequest(body))
}

describe('PATCH /api/admin/clients', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
    getProfileMock.mockReturnValue(ADMIN)
    sqlMock.mockResolvedValue([{ id: 'acc-1' }])
  })

  it('returns 403 for a non-admin', async () => {
    getProfileMock.mockReturnValue({ ...ADMIN, is_admin: false })
    expect((await patch({ accountId: 'acc-1', action: 'revoke' })).status).toBe(403)
  })

  it('grants an override and never writes accounts.plan', async () => {
    const res = await patch({
      accountId: 'acc-1', action: 'grant', plan: 'enterprise', reason: 'partner deal',
    })
    expect(res.status).toBe(200)
    const text = queryText(sqlMock.mock.calls[0][0]).toLowerCase()
    expect(text).toContain('override_plan')
    expect(text).not.toMatch(/set\s+plan\s*=/)
  })

  it('takes override_set_by from the session, not the body', async () => {
    await patch({
      accountId: 'acc-1', action: 'grant', plan: 'pro', reason: 'support',
      override_set_by: 'attacker', set_by: 'attacker',
    })
    const params = sqlMock.mock.calls[0].slice(1)
    expect(params).toContain('admin-1')
    expect(params).not.toContain('attacker')
  })

  it('accepts free as a downgrade comp', async () => {
    const res = await patch({
      accountId: 'acc-1', action: 'grant', plan: 'free', reason: 'abuse',
    })
    expect(res.status).toBe(200)
  })

  it('rejects a plan outside PLAN_IDS', async () => {
    const res = await patch({
      accountId: 'acc-1', action: 'grant', plan: 'platinum', reason: 'x',
    })
    expect(res.status).toBe(400)
  })

  it('rejects a grant with no reason', async () => {
    const res = await patch({ accountId: 'acc-1', action: 'grant', plan: 'pro', reason: '  ' })
    expect(res.status).toBe(400)
  })

  it('rejects an expiry in the past', async () => {
    const res = await patch({
      accountId: 'acc-1', action: 'grant', plan: 'pro', reason: 'x',
      expiresAt: '2020-01-01T00:00:00Z',
    })
    expect(res.status).toBe(400)
  })

  it('revokes by nulling all four override columns', async () => {
    const res = await patch({ accountId: 'acc-1', action: 'revoke' })
    expect(res.status).toBe(200)
    const text = queryText(sqlMock.mock.calls[0][0]).toLowerCase()
    expect(text).toContain('override_plan = null')
    expect(text).toContain('override_reason = null')
    expect(text).toContain('override_set_by = null')
    expect(text).toContain('override_expires_at = null')
  })

  it('returns 404 when the account does not exist', async () => {
    sqlMock.mockResolvedValue([])
    const res = await patch({ accountId: 'nope', action: 'revoke' })
    expect(res.status).toBe(404)
  })

  it('returns 5xx when the write fails', async () => {
    sqlMock.mockRejectedValue(new Error('connection failed'))
    const res = await patch({ accountId: 'acc-1', action: 'revoke' })
    expect(res.status).toBeGreaterThanOrEqual(500)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/api/admin-clients.test.ts -t "PATCH"`
Expected: FAIL — the old PATCH still validates against a hardcoded array and writes `plan`.

- [ ] **Step 3: Replace the PATCH handler**

First fix the imports in `app/api/admin/clients/route.ts`: **delete** the now-unused

```ts
import { createServiceSupabaseClient } from '@/lib/supabase-server'
```

and its explanatory comment, then **add**:

```ts
import { PLAN_IDS, type PlanId } from '@/lib/plans/catalog'
```

After this the file has no Supabase import at all. Now replace the entire existing `PATCH` function with:

```ts
function isPlanId(value: unknown): value is PlanId {
  return typeof value === 'string' && (PLAN_IDS as readonly string[]).includes(value)
}

export async function PATCH(req: NextRequest) {
  const admin = await requireApiAdmin()
  if (!admin.ok) return admin.response

  const body = await req.json().catch(() => null)
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { accountId, action } = body as { accountId?: unknown; action?: unknown }
  if (typeof accountId !== 'string' || !accountId) {
    return NextResponse.json({ error: 'accountId required' }, { status: 400 })
  }
  if (action !== 'grant' && action !== 'revoke') {
    return NextResponse.json({ error: "action must be 'grant' or 'revoke'" }, { status: 400 })
  }

  const sql = db()

  if (action === 'revoke') {
    try {
      const rows = await sql`
        update accounts
           set override_plan = null,
               override_reason = null,
               override_set_by = null,
               override_expires_at = null
         where id = ${accountId}
        returning id
      `
      if (!rows.length) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
      return NextResponse.json({ ok: true })
    } catch (err) {
      console.error('[admin/clients] revoke failed:', (err as Error)?.message ?? String(err))
      return NextResponse.json({ error: 'Failed to revoke override' }, { status: 500 })
    }
  }

  const { plan, reason, expiresAt } = body as {
    plan?: unknown; reason?: unknown; expiresAt?: unknown
  }

  // Validated against the catalog, not a hardcoded list — this is what allows
  // 'free' as a downgrade comp and keeps the endpoint correct as plans change.
  if (!isPlanId(plan)) {
    return NextResponse.json(
      { error: 'Invalid plan', valid: PLAN_IDS }, { status: 400 },
    )
  }

  const trimmedReason = typeof reason === 'string' ? reason.trim() : ''
  if (!trimmedReason) {
    return NextResponse.json({ error: 'reason required' }, { status: 400 })
  }

  // null expiry = permanent comp. A past timestamp is rejected rather than
  // stored, because an already-expired override is a silent no-op that reads as
  // success in the UI.
  let expiry: string | null = null
  if (expiresAt !== undefined && expiresAt !== null && expiresAt !== '') {
    if (typeof expiresAt !== 'string' || Number.isNaN(new Date(expiresAt).getTime())) {
      return NextResponse.json({ error: 'expiresAt must be an ISO-8601 timestamp' }, { status: 400 })
    }
    if (new Date(expiresAt).getTime() <= Date.now()) {
      return NextResponse.json({ error: 'expiresAt must be in the future' }, { status: 400 })
    }
    expiry = expiresAt
  }

  try {
    const rows = await sql`
      update accounts
         set override_plan = ${plan},
             override_reason = ${trimmedReason},
             override_set_by = ${admin.profile.id},
             override_expires_at = ${expiry}
       where id = ${accountId}
      returning id
    `
    if (!rows.length) return NextResponse.json({ error: 'Account not found' }, { status: 404 })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[admin/clients] grant failed:', (err as Error)?.message ?? String(err))
    return NextResponse.json({ error: 'Failed to grant override' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run the full admin API test file**

Run: `npx vitest run __tests__/api/admin-clients.test.ts`
Expected: PASS, 16 tests

- [ ] **Step 5: Verify types**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 0 errors

- [ ] **Step 6: Commit**

```bash
git add app/api/admin/clients/route.ts __tests__/api/admin-clients.test.ts
git commit -m "feat(admin): grant and revoke plan overrides via catalog-validated PATCH"
```

---

### Task 7: Admin UI

**Files:**
- Create: `components/admin/OverrideControls.tsx`
- Create: `components/admin/AccountRow.tsx`
- Modify: `app/admin/page.tsx`

- [ ] **Step 1: Create the override controls component**

Create `components/admin/OverrideControls.tsx`:

```tsx
'use client'
import { useState } from 'react'
import { PLAN_IDS, type PlanId } from '@/lib/plans/catalog'

export interface OverrideControlsProps {
  accountId: string
  currentOverride: PlanId | null
  busy: boolean
  onGrant: (accountId: string, plan: PlanId, reason: string, expiresAt: string | null) => void
  onRevoke: (accountId: string) => void
}

export function OverrideControls({
  accountId, currentOverride, busy, onGrant, onRevoke,
}: OverrideControlsProps) {
  const [plan, setPlan] = useState<PlanId>(currentOverride ?? 'pro')
  const [reason, setReason] = useState('')
  const [expiresAt, setExpiresAt] = useState('')

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* Options come from the catalog, so this cannot drift from pricing. */}
      <select
        value={plan}
        disabled={busy}
        onChange={e => setPlan(e.target.value as PlanId)}
        className="text-xs border border-slate-200 rounded px-2 py-1"
      >
        {PLAN_IDS.map(id => (
          <option key={id} value={id}>{id}</option>
        ))}
      </select>

      <input
        value={reason}
        disabled={busy}
        onChange={e => setReason(e.target.value)}
        placeholder="Reason (required)"
        className="text-xs border border-slate-200 rounded px-2 py-1"
      />

      <input
        type="date"
        value={expiresAt}
        disabled={busy}
        onChange={e => setExpiresAt(e.target.value)}
        title="Leave empty for a permanent comp"
        className="text-xs border border-slate-200 rounded px-2 py-1"
      />

      <button
        type="button"
        disabled={busy || !reason.trim()}
        onClick={() => onGrant(
          accountId, plan, reason.trim(),
          expiresAt ? new Date(`${expiresAt}T23:59:59Z`).toISOString() : null,
        )}
        className="text-xs rounded bg-slate-900 text-white px-2 py-1 disabled:opacity-40"
      >
        Grant
      </button>

      {currentOverride && (
        <button
          type="button"
          disabled={busy}
          onClick={() => onRevoke(accountId)}
          className="text-xs rounded border border-slate-300 px-2 py-1 disabled:opacity-40"
        >
          Revoke
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Create the account row component**

Create `components/admin/AccountRow.tsx`:

```tsx
'use client'
import type { PlanId } from '@/lib/plans/catalog'
import { OverrideControls } from './OverrideControls'

export interface AdminAccount {
  id: string
  plan: string
  status: string
  hasSubscription: boolean
  override_plan: PlanId | null
  override_reason: string | null
  override_expires_at: string | null
  override_set_by_name: string | null
  display_name: string | null
  clients: { id: string; brand_name: string; status: string }[]
  entitlement: {
    plan: PlanId
    source: string
    features: { max_brands: number; history_weeks: number; alerts: boolean; csv_export: boolean }
  }
}

export interface AccountRowProps {
  account: AdminAccount
  busy: boolean
  onGrant: (accountId: string, plan: PlanId, reason: string, expiresAt: string | null) => void
  onRevoke: (accountId: string) => void
}

export function AccountRow({ account, busy, onGrant, onRevoke }: AccountRowProps) {
  const { entitlement: ent } = account
  const overridden = ent.source === 'override'

  return (
    <tr className="border-b border-slate-100 align-top">
      <td className="px-4 py-3 text-slate-700">
        {account.display_name ?? account.id.slice(0, 8)}
      </td>

      <td className="px-4 py-3 text-slate-500">
        {account.clients?.map(c => c.brand_name).join(', ') || '—'}
      </td>

      {/* Stripe-derived state */}
      <td className="px-4 py-3 text-xs text-slate-500">
        {account.plan} / {account.status}
        <br />
        {account.hasSubscription ? 'subscription' : 'no subscription'}
      </td>

      {/* What the customer actually gets */}
      <td className="px-4 py-3 text-xs">
        <span className={`px-2 py-0.5 rounded font-medium ${
          overridden ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-700'
        }`}>
          {ent.plan} ({ent.source})
        </span>
        {overridden && (
          <div className="mt-1 text-[11px] text-slate-500">
            {account.override_reason}
            {account.override_set_by_name ? ` · by ${account.override_set_by_name}` : ''}
            {account.override_expires_at
              ? ` · until ${new Date(account.override_expires_at).toLocaleDateString()}`
              : ' · permanent'}
          </div>
        )}
        {/* Rendered from the catalog rather than restated here. */}
        <div className="mt-1 text-[11px] text-slate-500">
          {ent.features.max_brands} brands · {ent.features.history_weeks}w history
          {ent.features.alerts ? ' · alerts' : ''}
          {ent.features.csv_export ? ' · csv' : ''}
        </div>
      </td>

      <td className="px-4 py-3">
        <OverrideControls
          accountId={account.id}
          currentOverride={account.override_plan}
          busy={busy}
          onGrant={onGrant}
          onRevoke={onRevoke}
        />
      </td>
    </tr>
  )
}
```

- [ ] **Step 3: Reduce the page to fetch-and-map**

Replace the entire contents of `app/admin/page.tsx`:

```tsx
'use client'
import { useCallback, useEffect, useState } from 'react'
import type { PlanId } from '@/lib/plans/catalog'
import { AccountRow, type AdminAccount } from '@/components/admin/AccountRow'

export default function AdminPage() {
  const [accounts, setAccounts] = useState<AdminAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setError('')
    const res = await fetch('/api/admin/clients')
    if (!res.ok) {
      setError('Failed to load accounts.')
      setLoading(false)
      return
    }
    setAccounts(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { void load() }, [load])

  // Refetch rather than patching local state: entitlement is resolved
  // server-side, so the client cannot recompute it correctly.
  const send = async (body: Record<string, unknown>, accountId: string) => {
    setBusyId(accountId)
    setError('')
    const res = await fetch('/api/admin/clients', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      const data = await res.json().catch(() => ({}))
      setError(data.error ?? 'Request failed.')
    } else {
      await load()
    }
    setBusyId(null)
  }

  const onGrant = (accountId: string, plan: PlanId, reason: string, expiresAt: string | null) =>
    send({ accountId, action: 'grant', plan, reason, expiresAt }, accountId)

  const onRevoke = (accountId: string) =>
    send({ accountId, action: 'revoke' }, accountId)

  if (loading) return <p className="text-slate-400">Loading…</p>

  return (
    <div>
      <h1 className="text-xl font-black text-slate-900 mb-6">All Accounts</h1>
      {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left">
              <th className="px-4 py-3 text-slate-500 font-medium">Account</th>
              <th className="px-4 py-3 text-slate-500 font-medium">Brands</th>
              <th className="px-4 py-3 text-slate-500 font-medium">Stripe</th>
              <th className="px-4 py-3 text-slate-500 font-medium">Effective</th>
              <th className="px-4 py-3 text-slate-500 font-medium">Override</th>
            </tr>
          </thead>
          <tbody>
            {accounts.map(a => (
              <AccountRow
                key={a.id}
                account={a}
                busy={busyId === a.id}
                onGrant={onGrant}
                onRevoke={onRevoke}
              />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Verify types and lint**

Run: `npx tsc --noEmit -p tsconfig.json`
Expected: 0 errors

Run: `npm run lint`
Expected: 0 errors

- [ ] **Step 5: Commit**

```bash
git add components/admin app/admin/page.tsx
git commit -m "feat(admin): render catalog entitlements and override controls"
```

---

### Task 8: Apply the migration and verify end to end

**Files:** none — this task applies and verifies.

- [ ] **Step 1: Apply migration 028 to Neon**

There is no migration runner; migrations are applied by hand. Ask the repository owner to run it, or run it yourself if you have `DATABASE_URL`:

```bash
psql "$DATABASE_URL" -f supabase/migrations/028_account_plan_overrides.sql
```

- [ ] **Step 2: Verify the columns and trigger landed**

Create `verify-028.mjs` in the project root (it must live in the project directory, not `/tmp`, for `node_modules` resolution), run it, then delete it:

```js
import { neon } from '@neondatabase/serverless'
import fs from 'fs'
for (const l of fs.readFileSync('.env.local', 'utf8').split('\n')) {
  const i = l.indexOf('=')
  if (i > 0) process.env[l.slice(0, i).trim()] = l.slice(i + 1).trim().replace(/^["']|["']$/g, '')
}
const sql = neon(process.env.DATABASE_URL)
const cols = await sql`
  select column_name from information_schema.columns
  where table_name = 'accounts' and column_name like 'override%' order by 1`
console.log('override columns:', cols.map(c => c.column_name).join(', '))
const fn = await sql`
  select pg_get_functiondef(p.oid) as def from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'check_brand_limit'`
console.log('trigger honours override:', fn[0].def.includes('override_is_live'))
const gone = await sql`
  select count(*)::int c from information_schema.tables
  where table_schema = 'public' and table_name = 'plan_features'`
console.log('plan_features dropped:', gone[0].c === 0)
```

Run: `node verify-028.mjs 2>&1 | grep -v "postgresql://"`
Expected:
```
override columns: override_expires_at, override_plan, override_reason, override_set_by
trigger honours override: true
plan_features dropped: true
```

Then: `rm verify-028.mjs`

The `grep -v` is not optional — the Neon driver prints the full connection string, password included, in its error messages.

- [ ] **Step 3: Run the full verification suite**

```bash
npm test
npx tsc --noEmit -p tsconfig.json
npm run lint
npm run build
```

Expected: all tests pass with no failures; `tsc` 0 errors; lint 0 errors; build exits 0.

- [ ] **Step 4: Confirm the comp works end to end**

With the dev server running and signed in as an admin, visit `/admin`. Grant a `pro` comp to an account that has no Stripe subscription, with a reason. The Effective column must show `pro (override)` with the reason. Then, as that account, create brands up to 3 — the third must succeed, proving `check_brand_limit()` honoured the comp rather than capping at `free`'s limit of 1.

This is the one check the unit tests cannot make: they mock `sql`, so only a real insert proves the trigger agrees with the application.

- [ ] **Step 5: Commit any fixes and open a PR**

```bash
git push -u origin <branch>
gh pr create --base main --title "feat(admin): plan overrides that survive Stripe and the brand-limit trigger"
```

---

## Notes for the implementer

**If the trigger refuses a comped account's brand insert**, the migration did not apply or applied only partially. Re-run Step 2 of Task 8. Do not "fix" it by weakening the application-side check — the database is authoritative because it holds the advisory lock.

**Do not add comp history.** Re-granting overwrites the previous reason by design. An append-only audit table was explicitly rejected in the spec: it needs a correlated subquery inside a trigger that already holds an advisory lock, for history nobody has requested.

**Out of scope:** `app/[lang]/admin/authority/page.tsx` remains on the dead Supabase client, customer onboarding is a separate spec, and the wider 30-file Supabase→Neon migration is untouched.
