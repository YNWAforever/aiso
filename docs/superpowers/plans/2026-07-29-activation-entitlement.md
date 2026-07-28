# Activation — Entitlement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new signup that creates a brand — by either route — receives a 7-day Basic trial, so scanning from their own workspace works without a manual database write.

**Architecture:** One `lib/brands/` module owns brand creation and the trial grant. The grant is expressed as a **single SQL statement with data-modifying CTEs** rather than a transaction, because Neon's HTTP driver has no interactive transactions — and a single statement is atomic by definition. Admin bootstrap is a **derived** property (allowlist + verified email) rather than a persisted one, so removing an email revokes immediately.

**Tech Stack:** Next.js 16.2 App Router, TypeScript 5.9, Neon via `@neondatabase/serverless` (tagged templates only), Vitest 4.

**Spec:** `docs/superpowers/specs/2026-07-29-activation-path-design.md` (Workstreams 1 and 2)

---

## Critical context for the implementer

1. **`db()` is tagged-template only.** `` sql`select …` `` works; `sql('select …')` throws an error about tagged templates that reads like a missing table.
2. **`sql.transaction()` is NON-interactive.** It accepts an array of queries; you cannot read a value and then conditionally write inside it. This plan therefore uses one statement with CTEs. **Do not "improve" it into a transaction.**
3. **`account_id` always comes from the session**, never from request input. RLS is enabled but inert — the app connects as `neondb_owner` with `rolbypassrls = true`, so explicit filtering is the only tenant boundary.
4. **Neon throws where `supabase-js` returned `{ data, error }`.** Wrap DB work in `try`/`catch`; never return 2xx over a failed write.
5. **`clients.competitors` is `text[]`, not `jsonb`.** Pass a JS array with `::text[]`. Do not `JSON.stringify` it.
6. **The trial's tier is not automatic.** `resolveCommercialEntitlement` returns `activeEntitlement(account.plan, 'trial')`, so a trial inherits whatever `accounts.plan` holds. One live account carries `plan = 'enterprise'` with no subscription — it would otherwise get unmetered scans. The grant pins `plan = 'basic'`.
7. **Onboarding has a working rescue path today.** It grants the trial *before* its existing-client guard, so a stranded account can self-rescue by re-submitting. Task 4 preserves this. Breaking it makes stranding worse than the status quo.
8. **No new migration is needed.** `trial_started_at`, `trial_ends_at`, `plan`, and `is_admin` all exist. Migrations `001`–`029` are applied.
9. **Never print** a connection string, raw `neonctl --output json`, or the contents of any credential store or `.env` file.

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/brands/trial.ts` **(create)** | `ensureTrialForAccount(accountId)` — idempotent grant/repair, pins the tier |
| `lib/brands/create.ts` **(create)** | `createBrandForAccount(input)` — allowance check + atomic insert-and-grant |
| `lib/admin/allowlist.ts` **(create)** | `isAllowlistedAdminEmail(email, verified)` — pure, no env read |
| `app/api/dashboard/clients/route.ts` **(modify)** | Thin: gate → service → 200 / 403 |
| `app/api/onboarding/complete/route.ts` **(modify)** | Explicit ordering; rescue path; canonical 403 body |
| `lib/auth.ts` **(modify)** | Derive `is_admin` from the allowlist |
| `__tests__/lib/brand-trial.test.ts` **(create)** | Trial rule, all directions |
| `__tests__/lib/admin-allowlist.test.ts` **(create)** | Allowlist parsing and matching |
| `__tests__/integration/activation.test.ts` **(create)** | Atomicity, both routes, rescue path — real Postgres |
| `__tests__/api/dashboard-clients.test.ts` **(modify)** | Mock shape + new query order |
| `__tests__/api/onboarding-flow.test.ts` **(modify)** | Mock shape + new query order |

---

## Task 1: The trial grant

**Files:** Create `lib/brands/trial.ts`, `__tests__/lib/brand-trial.test.ts`

The whole rule lives in one SQL statement. Read it carefully before writing tests:

```sql
update accounts
set trial_started_at = coalesce(trial_started_at, now()),
    trial_ends_at    = coalesce(trial_ends_at, now() + interval '7 days'),
    plan = case
             when trial_started_at is null
              and coalesce(stripe_subscription_id, '') = ''
             then 'basic'
             else plan
           end
where id = $1
returning trial_ends_at
```

`coalesce` in a `SET` reads the **old** row value, which gives all three behaviours at once:
- never started → grants `now()` + 7 days, and pins `plan = 'basic'`;
- started but `trial_ends_at` null (a repair case onboarding handles today) → fills the expiry, leaves `plan` alone;
- already has both → changes nothing, returns the stored expiry.

An account with a live Stripe subscription never has its `plan` rewritten.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/brand-trial.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'

const calls: { text: string; values: unknown[] }[] = []
let nextResult: unknown[] = []

const mockSql = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
  calls.push({ text: strings.join('?'), values })
  if (nextResult instanceof Error) throw nextResult
  return Promise.resolve(nextResult)
})

vi.mock('@/lib/db', () => ({ db: () => mockSql }))

import { ensureTrialForAccount } from '@/lib/brands/trial'

const ACCOUNT = 'acc-1'

describe('ensureTrialForAccount', () => {
  beforeEach(() => {
    calls.length = 0
    nextResult = []
  })

  it('returns the expiry the database reports', async () => {
    const ends = new Date('2026-08-05T00:00:00.000Z')
    nextResult = [{ trial_ends_at: ends }]
    await expect(ensureTrialForAccount(ACCOUNT)).resolves.toEqual(ends)
  })

  it('scopes the update to the given account', async () => {
    nextResult = [{ trial_ends_at: new Date() }]
    await ensureTrialForAccount(ACCOUNT)
    expect(calls[0].values).toContain(ACCOUNT)
  })

  it('only starts a trial that has not started', async () => {
    nextResult = [{ trial_ends_at: new Date() }]
    await ensureTrialForAccount(ACCOUNT)
    expect(calls[0].text).toContain('coalesce(trial_started_at, now())')
  })

  it('repairs a missing expiry without restarting the trial', async () => {
    nextResult = [{ trial_ends_at: new Date() }]
    await ensureTrialForAccount(ACCOUNT)
    expect(calls[0].text).toContain('coalesce(trial_ends_at')
  })

  it('pins the tier to basic only when granting, and only without a subscription', async () => {
    nextResult = [{ trial_ends_at: new Date() }]
    await ensureTrialForAccount(ACCOUNT)
    const sqlText = calls[0].text
    expect(sqlText).toContain('when trial_started_at is null')
    expect(sqlText).toContain("coalesce(stripe_subscription_id, '') = ''")
    expect(sqlText).toContain("then 'basic'")
    expect(sqlText).toContain('else plan')
  })

  it('coerces an ISO string expiry to a Date', async () => {
    nextResult = [{ trial_ends_at: '2026-08-05T00:00:00.000Z' }]
    const result = await ensureTrialForAccount(ACCOUNT)
    expect(result).toBeInstanceOf(Date)
    expect(result.toISOString()).toBe('2026-08-05T00:00:00.000Z')
  })

  it('throws when the account does not exist', async () => {
    nextResult = []
    await expect(ensureTrialForAccount(ACCOUNT)).rejects.toThrow(/account/i)
  })

  it('propagates a database failure rather than returning a value', async () => {
    nextResult = new Error('connection terminated') as never
    await expect(ensureTrialForAccount(ACCOUNT)).rejects.toThrow('connection terminated')
  })
})
```

- [ ] **Step 2: Run it and observe the failure**

Run: `npx vitest run __tests__/lib/brand-trial.test.ts`

Expected: FAIL — `Failed to resolve import "@/lib/brands/trial"`.

- [ ] **Step 3: Write the implementation**

Create `lib/brands/trial.ts`:

```ts
import { db } from '@/lib/db'

/**
 * The trial grant, expressed as one statement.
 *
 * `coalesce` in a SET clause reads the OLD row value, so a single UPDATE covers
 * grant, repair, and no-op:
 *   - never started        -> now() + 7 days, and the tier is pinned to 'basic'
 *   - started, no expiry   -> expiry filled, tier untouched (onboarding's repair case)
 *   - already has both     -> unchanged, stored expiry returned
 *
 * The tier pin matters: resolveCommercialEntitlement returns
 * activeEntitlement(account.plan, 'trial'), so without it a trial inherits
 * whatever `accounts.plan` happens to hold — one live account carries
 * 'enterprise', which would grant unmetered scans.
 *
 * An account with a live Stripe subscription never has its plan rewritten.
 */
export async function ensureTrialForAccount(accountId: string): Promise<Date> {
  const sql = db()
  const rows = await sql`
    update accounts
    set trial_started_at = coalesce(trial_started_at, now()),
        trial_ends_at    = coalesce(trial_ends_at, now() + interval '7 days'),
        plan = case
                 when trial_started_at is null
                  and coalesce(stripe_subscription_id, '') = ''
                 then 'basic'
                 else plan
               end
    where id = ${accountId}
    returning trial_ends_at
  `
  const raw = rows[0]?.trial_ends_at
  if (raw === undefined || raw === null) {
    throw new Error(`ensureTrialForAccount: account ${accountId} not found`)
  }
  // The Neon driver returns timestamptz as a Date; test fixtures and older rows
  // still supply ISO strings. Accept both.
  return raw instanceof Date ? raw : new Date(String(raw))
}
```

- [ ] **Step 4: Run it and observe it pass**

Run: `npx vitest run __tests__/lib/brand-trial.test.ts`

Expected: PASS, 8 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/brands/trial.ts __tests__/lib/brand-trial.test.ts
git commit -m "feat(brands): grant a 7-day Basic trial idempotently

One statement covers grant, repair and no-op, because coalesce in a SET
reads the old row value. The tier is pinned because a trial otherwise
inherits accounts.plan, and one live account carries 'enterprise'.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: The brand-creation service

**Files:** Create `lib/brands/create.ts`

Brand creation and the trial grant must be atomic. Because the driver has no interactive transactions, they go in **one statement** with data-modifying CTEs: if the `check_brand_limit()` trigger raises on the insert, the whole statement aborts and no trial is granted.

- [ ] **Step 1: Write the implementation**

Create `lib/brands/create.ts`:

```ts
import { db } from '@/lib/db'
import { resolveCommercialEntitlement } from '@/lib/tier'
import type { PlanId } from '@/lib/plans/catalog'

export type CreateBrandInput = {
  accountId: string
  brandName: string
  domain?: string | null
  industry?: string | null
  region?: string | null
  description?: string | null
  competitors?: string[]
}

/**
 * A discriminated union rather than a thrown error: the brand limit is an
 * expected outcome, not an exception, and the service must not know about HTTP.
 * Database failures still throw.
 */
export type CreateBrandResult =
  | { ok: true; clientId: string; trialEndsAt: Date }
  | { ok: false; reason: 'BRAND_LIMIT_REACHED'; plan: PlanId; limit: number }

export async function createBrandForAccount(
  input: CreateBrandInput,
): Promise<CreateBrandResult> {
  const sql = db()

  const accountRows = await sql`
    select id, plan, status, stripe_customer_id, stripe_subscription_id,
           trial_started_at, trial_ends_at, trial_emails_sent, created_at,
           override_plan, override_expires_at
    from accounts where id = ${input.accountId} limit 1
  `
  const account = accountRows[0]
  if (!account) throw new Error(`createBrandForAccount: account ${input.accountId} not found`)

  const entitlement = resolveCommercialEntitlement(account as never)
  const plan = entitlement.plan
  const limit = entitlement.features.max_brands

  // Advisory pre-check for a clear error. check_brand_limit() is the authority
  // and catches the concurrent race below.
  const counted = await sql`
    select count(*)::int as n from clients where account_id = ${input.accountId}
  `
  if ((counted[0]?.n ?? 0) >= limit) {
    return { ok: false, reason: 'BRAND_LIMIT_REACHED', plan, limit }
  }

  // One statement, so it is atomic without an interactive transaction: a
  // trigger failure on the insert aborts the trial grant too. Splitting these
  // would reproduce the bug this work exists to fix — a brand with no trial.
  try {
    const rows = await sql`
      with inserted as (
        insert into clients (brand_name, domain, industry, region, description, competitors, account_id, status)
        values (
          ${input.brandName.trim()},
          ${input.domain?.trim() ?? null},
          ${input.industry ?? null},
          ${input.region ?? null},
          ${input.description ?? null},
          ${(Array.isArray(input.competitors) ? input.competitors : []) as string[]}::text[],
          ${input.accountId},
          'active'
        )
        returning id
      ),
      trial as (
        update accounts
        set trial_started_at = coalesce(trial_started_at, now()),
            trial_ends_at    = coalesce(trial_ends_at, now() + interval '7 days'),
            plan = case
                     when trial_started_at is null
                      and coalesce(stripe_subscription_id, '') = ''
                     then 'basic'
                     else plan
                   end
        where id = ${input.accountId}
        returning trial_ends_at
      )
      select inserted.id as client_id, trial.trial_ends_at
      from inserted, trial
    `
    const row = rows[0]
    if (!row) throw new Error('createBrandForAccount: insert returned no row')
    const raw = row.trial_ends_at
    return {
      ok: true,
      clientId: row.client_id as string,
      trialEndsAt: raw instanceof Date ? raw : new Date(String(raw)),
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    if (message.includes('BRAND_LIMIT_REACHED')) {
      return { ok: false, reason: 'BRAND_LIMIT_REACHED', plan, limit }
    }
    throw err
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`

Expected: 0 errors. If `.next/dev/types/` errors appear, run `rm -rf .next/dev && npx next typegen` first.

- [ ] **Step 3: Commit**

```bash
git add lib/brands/create.ts
git commit -m "feat(brands): create a brand and grant its trial atomically

One statement with data-modifying CTEs: the driver has no interactive
transactions, and a single statement aborts wholesale if check_brand_limit
raises, so a brand can never exist without its trial.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Point the dashboard route at the service

**Files:** Modify `app/api/dashboard/clients/route.ts`, `__tests__/api/dashboard-clients.test.ts`

- [ ] **Step 1: Rewrite the route**

Replace the whole file:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getProfile } from '@/lib/auth'
import { createBrandForAccount } from '@/lib/brands/create'

export const dynamic = 'force-dynamic'

// POST /api/dashboard/clients — self-service brand creation
export async function POST(req: NextRequest) {
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { brand_name, domain, industry, competitors } = body

  if (!brand_name || typeof brand_name !== 'string') {
    return NextResponse.json({ error: 'brand_name required' }, { status: 400 })
  }

  try {
    const result = await createBrandForAccount({
      accountId: profile.account_id,
      brandName: brand_name,
      domain,
      industry,
      competitors,
    })

    if (!result.ok) {
      return NextResponse.json(
        { error: result.reason, plan: result.plan, limit: result.limit },
        { status: 403 },
      )
    }

    return NextResponse.json({ id: result.clientId })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('Brand creation failed:', message.replace(/postgresql:\/\/\S+/g, '[redacted]'))
    return NextResponse.json({ error: 'Failed to create brand' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Update the existing suite for the new query order**

`__tests__/api/dashboard-clients.test.ts` queues mock results positionally, so the service's extra account lookup shifts everything. The route now issues, in order: account select → brand count → the CTE insert.

Change the happy-path fixture from two queued results to three:

```ts
nextResults = [
  [{ id: 'acc-1', plan: 'basic', status: 'active', stripe_subscription_id: 'sub_1',
     trial_started_at: null, trial_ends_at: null, override_plan: null, override_expires_at: null }],
  [{ n: 0 }],
  [{ client_id: 'client-1', trial_ends_at: new Date('2026-08-05T00:00:00.000Z') }],
]
```

and the limit-reached fixture to two (account, then count at the cap):

```ts
nextResults = [
  [{ id: 'acc-1', plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1',
     trial_started_at: null, trial_ends_at: null, override_plan: null, override_expires_at: null }],
  [{ n: 3 }],
]
```

Keep the 401, 400, and 500 cases. The 400 case must still assert no query ran, since validation precedes the service call.

- [ ] **Step 3: Run the suite**

Run: `npx vitest run __tests__/api/dashboard-clients.test.ts`

Expected: PASS. The 403 body still carries `plan` and `limit` — unchanged from today.

- [ ] **Step 4: Commit**

```bash
git add app/api/dashboard/clients/route.ts __tests__/api/dashboard-clients.test.ts
git commit -m "feat(dashboard): grant a trial when the first brand is created

The Add Brand wizard created a brand with no entitlement, so the account
stayed on free and scanning its own workspace returned 403. Routes now
share one service with onboarding.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Onboarding — explicit ordering and the rescue path

**Files:** Modify `app/api/onboarding/complete/route.ts`, `__tests__/api/onboarding-flow.test.ts`

**Read this before editing.** Onboarding currently grants the trial at lines 48–95, *before* its existing-client guard at 97–125. That ordering is load-bearing: an account that already has a brand but no trial can self-rescue by re-submitting onboarding, and `app/[lang]/onboarding/page.tsx` has no `requireAuth`, so the page is reachable. Naively moving the grant into brand creation deletes that path.

The required sequence:

1. Claim the anonymous scan (if `scanId` supplied) — unchanged.
2. `ensureTrialForAccount(accountId)` — **preserves the rescue**.
3. Existing-client guard — stamp the scan, return early.
4. `createBrandForAccount(...)`.
5. Stamp `scans.client_id` with the new brand — unchanged.
6. Generate seed prompts — unchanged, non-fatal.

- [ ] **Step 1: Replace the trial block (lines 48–95) with the service call**

```ts
  // Runs BEFORE the existing-client guard below, deliberately: an account that
  // already has a brand but no trial can self-rescue by re-submitting
  // onboarding. Moving this after the guard would remove that path.
  let trialEndsAt: Date
  try {
    trialEndsAt = await ensureTrialForAccount(accountId)
  } catch (err) {
    console.error('[onboarding] failed to start trial:', (err as Error)?.message ?? String(err))
    return NextResponse.json({ error: 'Failed to start trial' }, { status: 500 })
  }
```

Add `import { ensureTrialForAccount } from '@/lib/brands/trial'` and
`import { createBrandForAccount } from '@/lib/brands/create'`. Remove the now-unused
`toDate` and `SEVEN_DAYS_MS` helpers **only if nothing else in the file uses them** — check first.

- [ ] **Step 2: Replace the client insert (lines 127–153) with the service call**

```ts
  let clientId: string
  const created = await createBrandForAccount({
    accountId,
    brandName,
    domain,
    industry,
    region,
    description,
    competitors,
  })
  if (!created.ok) {
    // Canonical 403 body, matching POST /api/dashboard/clients. This route
    // previously returned a bare { error } with no plan or limit.
    return NextResponse.json(
      { error: created.reason, plan: created.plan, limit: created.limit },
      { status: 403 },
    )
  }
  clientId = created.clientId
```

Wrap in `try`/`catch` returning `{ error: 'Failed to create client' }` at 500, matching current behaviour for a genuine database failure.

- [ ] **Step 3: Leave the existing-client early return alone**

It already returns `trialEndsAt.toISOString()`; that variable now comes from `ensureTrialForAccount`, so the early return keeps reporting a real expiry.

- [ ] **Step 4: Update the suite**

`__tests__/api/onboarding-flow.test.ts` queues results positionally. The new order is: claim (if `scanId`) → trial update → existing-client select → [CTE insert via service: account select, count, insert] → scan stamp → prompts.

Update each fixture accordingly and keep the existing assertions, including
`returns existing clientId on double-submit (idempotent)` which must still expect **200**.

Add one new case: an account with a brand and no trial re-submits, receives 200, and the
trial update ran — the rescue path.

- [ ] **Step 5: Run both suites**

Run: `npx vitest run __tests__/api/onboarding-flow.test.ts __tests__/api/onboarding.test.ts`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add app/api/onboarding/complete/route.ts __tests__/api/onboarding-flow.test.ts
git commit -m "refactor(onboarding): share brand creation, keep the rescue path

The trial grant stays ahead of the existing-client guard so a stranded
account can still self-rescue by re-submitting. The 403 body now carries
plan and limit, matching the dashboard route.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Admin bootstrap by allowlist

**Files:** Create `lib/admin/allowlist.ts`, `__tests__/lib/admin-allowlist.test.ts`; modify `lib/auth.ts`

**Design note, differing from the spec:** the spec had the signup webhook write `is_admin = true`
durably, plus a console control to revoke. Persisting the grant is what created the need to
revoke. Deriving it instead means removing an email from `ADMIN_EMAILS` takes effect
immediately, the webhook is untouched, and no revocation UI is needed. The database column
remains the durable record for anyone granted by other means.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/admin-allowlist.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { isAllowlistedAdminEmail } from '@/lib/admin/allowlist'

describe('isAllowlistedAdminEmail', () => {
  const list = 'Owner@Example.com, second@example.com'

  it('matches case-insensitively', () => {
    expect(isAllowlistedAdminEmail('owner@example.com', true, list)).toBe(true)
    expect(isAllowlistedAdminEmail('OWNER@EXAMPLE.COM', true, list)).toBe(true)
  })

  it('ignores surrounding whitespace in both the list and the email', () => {
    expect(isAllowlistedAdminEmail('  second@example.com  ', true, list)).toBe(true)
  })

  it('rejects an email not on the list', () => {
    expect(isAllowlistedAdminEmail('nobody@example.com', true, list)).toBe(false)
  })

  it('rejects an unverified email even when listed', () => {
    expect(isAllowlistedAdminEmail('owner@example.com', false, list)).toBe(false)
  })

  it('grants nobody when the list is empty, blank, or undefined', () => {
    expect(isAllowlistedAdminEmail('owner@example.com', true, '')).toBe(false)
    expect(isAllowlistedAdminEmail('owner@example.com', true, '   ')).toBe(false)
    expect(isAllowlistedAdminEmail('owner@example.com', true, undefined)).toBe(false)
  })

  it('rejects a null or empty email', () => {
    expect(isAllowlistedAdminEmail(null, true, list)).toBe(false)
    expect(isAllowlistedAdminEmail('', true, list)).toBe(false)
  })

  it('ignores empty entries produced by trailing commas', () => {
    expect(isAllowlistedAdminEmail('', true, 'a@b.com,,')).toBe(false)
  })
})
```

- [ ] **Step 2: Run it and observe the failure**

Run: `npx vitest run __tests__/lib/admin-allowlist.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Write the implementation**

Create `lib/admin/allowlist.ts`:

```ts
/**
 * Admin is DERIVED from configuration, not persisted by this path — so removing
 * an address from ADMIN_EMAILS revokes immediately. Nothing in the codebase
 * writes is_admin = false, so a durable grant would be effectively permanent.
 *
 * The list is server-only. It must never be exposed as NEXT_PUBLIC_.
 *
 * `verified` is required because the email comes from the session; an
 * unverified claimed address must never confer admin.
 *
 * The raw list is a parameter rather than a process.env read so this stays pure
 * and testable.
 */
export function isAllowlistedAdminEmail(
  email: string | null | undefined,
  verified: boolean,
  rawList: string | undefined,
): boolean {
  if (!email || !verified || !rawList) return false
  const needle = email.trim().toLowerCase()
  if (!needle) return false
  return rawList
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter(Boolean)
    .includes(needle)
}
```

- [ ] **Step 4: Run it and observe it pass**

Run: `npx vitest run __tests__/lib/admin-allowlist.test.ts`

Expected: PASS, 7 tests.

- [ ] **Step 5: Wire it into `getProfile()`**

In `lib/auth.ts`, add the import and change the returned `is_admin`:

```ts
import { isAllowlistedAdminEmail } from '@/lib/admin/allowlist'
```

Replace `is_admin: row.is_admin,` with:

```ts
    // Derived, not persisted: removing an address from ADMIN_EMAILS revokes on
    // the next request. The column remains the durable record for grants made
    // by other means.
    is_admin: Boolean(row.is_admin) || isAllowlistedAdminEmail(
      data.user.email,
      Boolean((data.user as { emailVerified?: boolean }).emailVerified),
      process.env.ADMIN_EMAILS,
    ),
```

Read `lib/auth.ts` around line 32 first to match the surrounding shape exactly.

- [ ] **Step 6: Run the auth suites and the gates**

```bash
npx vitest run __tests__/lib/admin-allowlist.test.ts && npm run test:unit && npm run lint && npx tsc --noEmit
```

Expected: all pass, lint 0 errors.

- [ ] **Step 7: Commit**

```bash
git add lib/admin/allowlist.ts lib/auth.ts __tests__/lib/admin-allowlist.test.ts
git commit -m "feat(auth): derive admin from a verified-email allowlist

is_admin had no in-product writer, so a fresh environment could not reach
/admin at all. Deriving rather than persisting means removing an address
revokes immediately — nothing in the codebase writes is_admin = false.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Prove it against real Postgres

**Files:** Create `__tests__/integration/activation.test.ts`

Mocks cannot prove atomicity. This repository has twice shipped a green suite over code that was entirely broken in production.

- [ ] **Step 1: Write the test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.TEST_DATABASE_URL!)

const ACCT = '44444444-4444-4444-4444-444444444444'

async function seed(plan: string, opts: { sub?: string | null } = {}) {
  await sql`delete from scans where account_id = ${ACCT}`
  await sql`delete from clients where account_id = ${ACCT}`
  await sql`delete from accounts where id = ${ACCT}`
  await sql`
    insert into accounts (id, plan, status, stripe_subscription_id)
    values (${ACCT}, ${plan}, 'active', ${opts.sub ?? null})
  `
}

async function grantTrial() {
  return sql`
    update accounts
    set trial_started_at = coalesce(trial_started_at, now()),
        trial_ends_at    = coalesce(trial_ends_at, now() + interval '7 days'),
        plan = case when trial_started_at is null
                     and coalesce(stripe_subscription_id, '') = ''
                    then 'basic' else plan end
    where id = ${ACCT}
    returning trial_ends_at
  `
}

describe('activation against real Postgres', () => {
  beforeEach(async () => { await seed('basic') })

  it('grants a 7-day trial on first call', async () => {
    const rows = await grantTrial()
    expect(rows[0].trial_ends_at).toBeTruthy()
    const acct = await sql`select trial_started_at from accounts where id = ${ACCT}`
    expect(acct[0].trial_started_at).toBeTruthy()
  })

  it('does not restart an existing trial', async () => {
    const first = await grantTrial()
    const second = await grantTrial()
    expect(new Date(second[0].trial_ends_at as string).getTime())
      .toBe(new Date(first[0].trial_ends_at as string).getTime())
  })

  it('pins an enterprise account to basic when granting', async () => {
    await seed('enterprise')
    await grantTrial()
    const acct = await sql`select plan from accounts where id = ${ACCT}`
    expect(acct[0].plan).toBe('basic')
  })

  it('leaves the plan alone when a subscription exists', async () => {
    await seed('pro', { sub: 'sub_live' })
    await grantTrial()
    const acct = await sql`select plan from accounts where id = ${ACCT}`
    expect(acct[0].plan).toBe('pro')
  })

  it('repairs a missing expiry without moving the start date', async () => {
    await sql`
      update accounts set trial_started_at = now() - interval '2 days', trial_ends_at = null
      where id = ${ACCT}
    `
    await grantTrial()
    const acct = await sql`select trial_started_at, trial_ends_at from accounts where id = ${ACCT}`
    expect(acct[0].trial_ends_at).toBeTruthy()
    expect(new Date(acct[0].trial_started_at as string).getTime())
      .toBeLessThan(Date.now() - 60_000)
  })

  it('grants no trial when the brand insert is rejected', async () => {
    // basic caps at 1 brand; create one, then attempt a second in the same
    // statement shape the service uses. The trigger aborts the whole statement.
    await sql`
      insert into clients (brand_name, account_id, status, competitors)
      values ('First', ${ACCT}, 'active', ${[]}::text[])
    `
    await sql`update accounts set trial_started_at = null, trial_ends_at = null where id = ${ACCT}`

    await expect(sql`
      with inserted as (
        insert into clients (brand_name, account_id, status, competitors)
        values ('Second', ${ACCT}, 'active', ${[]}::text[])
        returning id
      ),
      trial as (
        update accounts
        set trial_started_at = coalesce(trial_started_at, now()),
            trial_ends_at    = coalesce(trial_ends_at, now() + interval '7 days')
        where id = ${ACCT}
        returning trial_ends_at
      )
      select inserted.id, trial.trial_ends_at from inserted, trial
    `).rejects.toThrow(/BRAND_LIMIT_REACHED/)

    const acct = await sql`select trial_started_at from accounts where id = ${ACCT}`
    expect(acct[0].trial_started_at).toBeNull()
  })
})
```

The last test is the one that matters: it proves the CTE really is atomic, so a rejected insert leaves no trial behind.

- [ ] **Step 2: Run it**

Run: `npm run test:integration 2>&1 | grep -v "postgresql://"`

Expected: PASS. The harness provisions an ephemeral Neon branch and drops it afterwards.

- [ ] **Step 3: Commit**

```bash
git add __tests__/integration/activation.test.ts
git commit -m "test(activation): prove the trial grant is atomic and tier-pinned

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 7: Full verification

- [ ] **Step 1: Run every gate**

```bash
npm test 2>&1 | grep -v "postgresql://" && npm run lint && npx tsc --noEmit
```

Expected: unit and integration suites green, lint 0 errors, tsc clean.

- [ ] **Step 2: Confirm no route grants a trial outside the service**

```bash
grep -rn "trial_started_at" --include="*.ts" app lib | grep -v "lib/brands/trial.ts" | grep -v "lib/tier.ts"
```

Expected: no writes outside `lib/brands/trial.ts`. Reads in `lib/auth.ts` and `lib/trial.ts` are fine.

- [ ] **Step 3: Live verification (human)**

Set `ADMIN_EMAILS` in `.env.local`, restart the dev server, then:

1. Sign up with a genuinely new email.
2. Create a brand from the dashboard wizard.
3. Confirm the trial banner appears and a scan from that brand's workspace succeeds — this is the exact path that returned 403 before.
4. Confirm `/admin` is reachable for a listed email and 404s or redirects for an unlisted one.

---

## Definition of done

- A brand created by either route leaves the account with a live 7-day Basic trial.
- An account with `plan = 'enterprise'` and no subscription receives a **Basic** trial, proven against real Postgres.
- A rejected brand insert leaves no trial — proven, not assumed.
- Onboarding's rescue path still works: re-submitting with an existing brand grants the trial and returns 200.
- Both routes return the same 403 body for `BRAND_LIMIT_REACHED`.
- `/admin` is reachable by configuration alone, and removing an address revokes on the next request.

Workstreams 3 and 4 — honest plan presentation, the `LockedFeature` `res.ok` fix, and configuration — get their own plan.
