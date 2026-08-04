# Critical Path — Slice 3: Brand Workspace Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a brand you just created actually openable — the workspace loads from Neon and shows that brand's scans, not the account's.

**Architecture:** Scans currently have no relation to brands; they carry only `account_id`. Migration `029` adds a nullable `scans.client_id`, the scan route persists the `clientId` it already resolves, and the workspace and overview API filter by it. Both read paths move from the dead Supabase client to `db()`.

**Tech Stack:** Next.js 16.2 App Router, React 19, TypeScript 5.9, Neon via `@neondatabase/serverless` (tagged templates only), Vitest 4.

**Spec:** `docs/superpowers/specs/2026-07-26-critical-path-to-production-design.md`
**Preceding plan:** `docs/superpowers/plans/2026-07-26-critical-path-slices-0-2.md` (complete)

---

## Critical context for the implementer

1. **`db()` is tagged-template only.** `` sql`select …` `` works; `sql('select …')` throws an error about tagged templates that reads like a missing table.
2. **Neon throws where `supabase-js` resolved `{ data, error }`.** Every migrated read needs `try`/`catch`. A page that renders empty because the database is down must not be indistinguishable from a brand with no scans.
3. **RLS is inert.** Filter by `account_id` explicitly, always from the session, never from a URL parameter or body.
4. **A migration runner now exists** (`npm run migrate`). Production is baselined; `027` is the only other pending migration and Slice 6 owns it. Your `029` will sit pending alongside it until you deliberately apply it.
5. **Do not edit migrations `001`–`028`.** They are applied. Add `029`.
6. **Integration tests run against a real Neon branch** (`npm run test:integration`). `npm test` runs unit then integration. Never let a DB-backed test pass by mocking.
7. **NEVER print a connection string, and never print raw `neonctl --output json`** — its `connection_parameters.password` field is the production database password.
8. **`eslint.config.mjs` carries a `SUPABASE_MIGRATION_DEBT` allowlist.** As you migrate each file, REMOVE it from that list — that is how the guard tightens. The file is protected by a hook, so if your edit is blocked, report it rather than working around it. Note the glob-escaping gotcha already documented in that file: `[lang]` unescaped is a character class.

---

## What Slice 3 does NOT cover

- `app/api/onboarding/complete/route.ts` and `app/[lang]/onboarding/page.tsx` — Slice 3b. `complete/route.ts` imports `claimScanForAccount` from `app/api/scans/[id]/claim/route.ts` and passes it a Supabase **client object**, so migrating it requires changing that function's signature and migrating the claim route too. Kept separate deliberately.
- `app/[lang]/dashboard/[clientId]/result/[scanId]/page.tsx` — Slice 4.
- Backfilling `client_id` on the 28 existing scans. They are all anonymous public-funnel scans with no brand; they stay `NULL` and correctly appear in no workspace.

---

## File Structure

| File | Responsibility |
|---|---|
| `supabase/migrations/029_scans_client_id.sql` **(create)** | Nullable `scans.client_id` FK + index; tenant-consistency constraint |
| `app/api/scan/route.ts` **(modify)** | Persist the already-resolved `clientId`; migrate its one remaining Supabase call |
| `app/[lang]/dashboard/[clientId]/page.tsx` **(modify)** | Workspace reads on `db()`, scoped to the brand |
| `app/api/clients/[clientId]/overview/route.ts` **(modify)** | Overview API on `db()`, scoped to the brand |
| `__tests__/integration/brand-workspace.test.ts` **(create)** | Brand scoping proven against real Postgres |
| `eslint.config.mjs` **(modify)** | Drop the three migrated files from `SUPABASE_MIGRATION_DEBT` |

---

## Task 1: Add `scans.client_id`

**Files:** Create `supabase/migrations/029_scans_client_id.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 029_scans_client_id.sql
-- Scans carried only account_id, so a brand workspace could not distinguish its
-- own scans from any other brand's on the same account. Nullable because
-- anonymous public-funnel scans legitimately belong to no brand.

alter table public.scans
  add column if not exists client_id uuid;

do $scans_client_fk$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'scans_client_id_fkey'
      and conrelid = 'public.scans'::regclass
  ) then
    alter table public.scans
      add constraint scans_client_id_fkey
      foreign key (client_id) references public.clients (id) on delete set null;
  end if;
end
$scans_client_fk$;

-- A scan must not point at a brand owned by a different account. clients
-- carries a (id, account_id) unique constraint (migration 021) precisely so
-- this composite FK is expressible.
do $scans_tenant_fk$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'scans_client_tenant_fkey'
      and conrelid = 'public.scans'::regclass
  ) then
    alter table public.scans
      add constraint scans_client_tenant_fkey
      foreign key (client_id, account_id) references public.clients (id, account_id)
      on delete set null;
  end if;
end
$scans_tenant_fk$;

create index if not exists scans_client_created_idx
  on public.scans (client_id, created_at desc);
```

- [ ] **Step 2: Verify it applies to a clean database**

Run: `npm run test:integration 2>&1 | grep -v "postgresql://"`

Expected: `Applying 029_scans_client_id.sql … ok` and the existing 8 tests still pass. The ledger-completeness test in `migrate.test.ts` compares against `listMigrationFiles()`, so it picks `029` up automatically.

If it fails, fix `029` — it has not been applied anywhere yet, so editing it freely is correct.

- [ ] **Step 3: Confirm it also applies to production's shape**

Run: `npm run migrate -- --dry-run 2>&1 | grep -v "postgresql://"`

Expected: two pending migrations, `027` and `029`. **Do not apply either.** Both are applied at deploy time, in order, by whoever ships this slice.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/029_scans_client_id.sql
git commit -m "feat(db): relate scans to brands via scans.client_id

Scans carried only account_id, so a brand workspace showed whichever scan
ran most recently anywhere on the account. Nullable because anonymous
public-funnel scans belong to no brand.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 2: Persist `client_id` when a scan runs

**Files:** Modify `app/api/scan/route.ts`

This route already accepts a `clientId`, validates it, and resolves `ownedClient` — it simply never stores the result. Its `insert into scans` is **already on `db()`** (around line 297). The only Supabase use left is the ownership lookup around line 100.

- [ ] **Step 1: Read the route's ownership block**

Read lines 85–170 of `app/api/scan/route.ts`. Note exactly what `createServiceSupabaseClient()` is used for and what shape `ownedClient` has.

- [ ] **Step 2: Migrate the ownership lookup to `db()`**

Replace the `createServiceSupabaseClient()` lookup with a tagged-template query that resolves the client **scoped to the caller's account**, and delete the `import { createServiceSupabaseClient } from '@/lib/supabase-server'` line. The query shape:

```ts
const sql = db()
const ownedRows = await sql`
  select id, domain, industry, region
  from clients
  where id = ${requestedClientId} and account_id = ${profile.account_id}
  limit 1
`
const ownedClient = ownedRows[0] ?? null
```

Wrap it in `try`/`catch` and return 500 on failure. Preserve the existing 400 `Invalid clientId` behaviour for a well-formed id that resolves to nothing, and keep the existing shape of `ownedClient` so downstream code (`clientId`, `geoContext`) is unchanged.

- [ ] **Step 3: Add `client_id` to the insert**

In the existing `insert into scans (...)` tagged template, add `client_id` to the column list and `${clientId ?? null}` to the values, matching the column order exactly.

- [ ] **Step 4: Run the scan tests**

Run: `npx vitest run __tests__/api/scan.test.ts __tests__/api/scan-flow.test.ts __tests__/api/scan-security.test.ts`

Expected: pass. Any suite mocking the Supabase client for this route must be updated to mock `@/lib/db` instead. Say which you changed.

- [ ] **Step 5: Remove the file from the ESLint allowlist**

Delete `"app/api/scan/route.ts"` from `SUPABASE_MIGRATION_DEBT` in `eslint.config.mjs`, then run `npm run lint` and confirm 0 errors. If the config-protection hook blocks the edit, leave it, report it, and continue.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(scan): record which brand a scan belongs to

The route already resolved clientId and never stored it. Also migrates the
last Supabase call in this file, so it is fully on Neon.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 3: Prove brand scoping against real Postgres

**Files:** Create `__tests__/integration/brand-workspace.test.ts`

Write this test BEFORE migrating the read paths, so it fails for the right reason first.

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { neon } from '@neondatabase/serverless'

const sql = neon(process.env.TEST_DATABASE_URL!)

const ACCOUNT = '22222222-2222-2222-2222-222222222222'
const OTHER   = '33333333-3333-3333-3333-333333333333'

async function seed() {
  await sql`delete from scans where account_id in (${ACCOUNT}, ${OTHER})`
  await sql`delete from clients where account_id in (${ACCOUNT}, ${OTHER})`
  await sql`delete from accounts where id in (${ACCOUNT}, ${OTHER})`
  for (const id of [ACCOUNT, OTHER]) {
    await sql`insert into accounts (id, plan, status, stripe_subscription_id)
              values (${id}, 'pro', 'active', ${'sub_' + id.slice(0, 8)})`
  }
}

async function brand(account: string, name: string): Promise<string> {
  const rows = await sql`
    insert into clients (brand_name, account_id, status, competitors)
    values (${name}, ${account}, 'active', ${[]}::text[])
    returning id
  `
  return rows[0].id as string
}

async function scan(account: string, clientId: string | null, domain: string) {
  await sql`
    insert into scans (url, domain, results, account_id, client_id)
    values (${'https://' + domain}, ${domain}, ${'{}'}::jsonb, ${account}, ${clientId})
  `
}

describe('brand-scoped scans', () => {
  beforeEach(seed)

  it('returns only the scans belonging to the requested brand', async () => {
    const a = await brand(ACCOUNT, 'Brand A')
    const b = await brand(ACCOUNT, 'Brand B')
    await scan(ACCOUNT, a, 'a.example')
    await scan(ACCOUNT, b, 'b.example')

    const rows = await sql`
      select domain from scans
      where client_id = ${a} and account_id = ${ACCOUNT}
    `
    expect(rows.map(r => r.domain)).toEqual(['a.example'])
  })

  it('excludes anonymous scans that belong to no brand', async () => {
    const a = await brand(ACCOUNT, 'Brand A')
    await scan(ACCOUNT, null, 'anon.example')

    const rows = await sql`
      select domain from scans where client_id = ${a} and account_id = ${ACCOUNT}
    `
    expect(rows).toHaveLength(0)
  })

  it('refuses a scan pointing at a brand owned by another account', async () => {
    const foreign = await brand(OTHER, 'Someone Else')
    await expect(scan(ACCOUNT, foreign, 'x.example')).rejects.toThrow()
  })

  it('nulls client_id rather than deleting the scan when a brand is removed', async () => {
    const a = await brand(ACCOUNT, 'Brand A')
    await scan(ACCOUNT, a, 'a.example')
    await sql`delete from clients where id = ${a}`
    const rows = await sql`select client_id from scans where account_id = ${ACCOUNT}`
    expect(rows).toHaveLength(1)
    expect(rows[0].client_id).toBeNull()
  })
})
```

- [ ] **Step 2: Run it**

Run: `npm run test:integration 2>&1 | grep -v "postgresql://"`

Expected: all four pass once `029` is applied by the harness. The third test is the one that matters — it proves the composite FK actually blocks cross-tenant association rather than merely documenting the intent.

- [ ] **Step 3: Commit**

```bash
git add __tests__/integration/brand-workspace.test.ts
git commit -m "test(db): prove scans are brand-scoped and tenant-safe

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 4: Migrate the overview API

**Files:** Modify `app/api/clients/[clientId]/overview/route.ts`

Current behaviour to preserve: returns a `ClientOverview`, 401 unauthenticated, 404 when the client is not owned by the caller's account, and degrades to empty arrays for optional sections.

Current behaviour to CHANGE: `latestScan` and `scanHistory` filter by `account_id` only. They must filter by `client_id` too.

- [ ] **Step 1: Rewrite the route on `db()`**

Replace the whole file body, keeping the exported `GET` signature and the `ClientOverview` shape:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { getProfile } from '@/lib/auth'
import { db } from '@/lib/db'
import type { ClientOverview, Scan, AgentRecommendation, AgentProgress, AgentCompetitor, PulseWeeklySummary, PulseMetric } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ clientId: string }> }
) {
  const { clientId } = await params
  const profile = await getProfile()
  if (!profile) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const sql = db()

  try {
    const clientRows = await sql`
      select brand_name from clients
      where id = ${clientId} and account_id = ${profile.account_id}
      limit 1
    `
    if (!clientRows[0]) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Brand-scoped, not account-scoped — a workspace shows only its own scans.
    const latestRows = await sql`
      select * from scans
      where client_id = ${clientId} and account_id = ${profile.account_id}
      order by created_at desc limit 1
    `
    const latestScan = (latestRows[0] ?? null) as Scan | null
    const scanId = latestScan?.id ?? null

    const [scanHistory, recommendations, progress, competitors, pulseSummary, pulseMetrics] =
      await Promise.all([
        sql`
          select id, domain, score, grade, created_at from scans
          where client_id = ${clientId} and account_id = ${profile.account_id}
          order by created_at desc limit 10
        `,
        scanId
          ? sql`select * from agent_recommendations where scan_id = ${scanId}
                 order by priority, impact_score desc`
          : Promise.resolve([]),
        scanId
          ? sql`select * from agent_progress where scan_id = ${scanId}`
          : Promise.resolve([]),
        scanId
          ? sql`select * from agent_competitors where scan_id = ${scanId}
                 order by mention_rate desc`
          : Promise.resolve([]),
        sql`select * from pulse_weekly_summary
             where client_id = ${clientId} order by scan_week limit 40`,
        sql`select platform, question, competitors_mentioned, scan_week
             from pulse_metrics
             where client_id = ${clientId} and brand_mentioned = false
             order by scan_week desc limit 10`,
      ])

    const summary = pulseSummary as unknown as PulseWeeklySummary[]
    const latestWeek = summary.filter(d => !d.platform).at(-1)?.scan_week
    const kpiRow = summary.find(d => d.scan_week === latestWeek && !d.platform)
    const platformCount = [...new Set(
      summary.filter(d => d.scan_week === latestWeek && d.platform).map(d => d.platform)
    )].length

    const overview: ClientOverview = {
      client: { brand_name: clientRows[0].brand_name as string },
      latestScan,
      scanHistory: scanHistory as unknown as Pick<Scan, 'id' | 'domain' | 'score' | 'grade' | 'created_at'>[],
      recommendations: recommendations as unknown as AgentRecommendation[],
      progress: progress as unknown as AgentProgress[],
      competitors: competitors as unknown as AgentCompetitor[],
      pulseSummary: summary,
      pulseKpi: kpiRow ? {
        sovScore: kpiRow.sov_score,
        brandMentions: kpiRow.brand_mentions,
        totalQueries: kpiRow.total_queries,
        platformCount,
        scanWeek: kpiRow.scan_week,
      } : null,
      missedOpportunities: (pulseMetrics as unknown as PulseMetric[]).map(m => ({
        platform: m.platform,
        question: m.question,
        competitors_mentioned: m.competitors_mentioned,
        scan_week: m.scan_week,
      })),
    }

    return NextResponse.json(overview)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[overview] query failed:', message.replace(/postgresql:\/\/\S+/g, '[redacted]'))
    return NextResponse.json({ error: 'Failed to load overview' }, { status: 500 })
  }
}
```

Note the deliberate behaviour change: the old code logged per-query failures and still returned HTTP 200 with empty arrays, so a broken database looked like a brand with no data. Now a query failure returns 500. That is the point of the migration.

The pulse and agent tables are still read even though those *features* are fenced. Fencing blocks invoking a feature; it does not blank historical rows, and these are plain SELECTs against tables that exist. Both are empty today.

- [ ] **Step 2: Update the unit suite**

If a suite covers this route, rewrite its mocks from Supabase to `@/lib/db` using the tagged-template mock pattern established in `__tests__/api/dashboard-clients.test.ts`. Add a case asserting the 500 on database failure. Say which files you changed.

- [ ] **Step 3: Run the gates**

```bash
npm run test:unit && npm run lint && npx tsc --noEmit
```

If `tsc` reports `.next/dev/types/` errors, run `rm -rf .next/dev && npx next typegen` first.

- [ ] **Step 4: Remove from the ESLint allowlist and commit**

Delete `"app/api/clients/[clientId]/overview/route.ts"` from `SUPABASE_MIGRATION_DEBT` (remember the escaped brackets), re-run lint, then:

```bash
git add -A
git commit -m "feat(dashboard): serve the brand overview from Neon, scoped to the brand

Scans were filtered by account only, so a workspace showed whichever scan
ran most recently anywhere on the account. Also returns 5xx on a database
failure instead of an empty 200.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 5: Migrate the workspace page

**Files:** Modify `app/[lang]/dashboard/[clientId]/page.tsx`

Ten query sites. Read the whole file first — it has branching behaviour driven by the `step` and `scanId` search params, and a `findNewestMatchingScan(rows, domain)` domain-matching heuristic used by the ROI step that exists **only because `client_id` did not**.

- [ ] **Step 1: Migrate every query to `db()`**

Apply the same rules as Task 4:
- `client` lookup: `id` + `account_id`, `notFound()` when absent.
- `latestScan`, `scanHistory`, and the ROI `localTrustScans` list: add `client_id = ${clientId}`.
- `specificScan` (when `?scanId=` is present): match on `id`, `account_id` **and** `client_id`, so a scan id from another brand cannot be rendered inside this workspace.
- `pulse_weekly_summary` / `pulse_metrics`: already keyed by `client_id`; keep as-is.
- agent tables: keyed by `scan_id`; keep as-is.
- Wrap all database work in `try`/`catch`. On failure, render an error state — do NOT `notFound()`, which would tell the user their brand does not exist when the database is merely down.

- [ ] **Step 2: Simplify the ROI domain heuristic**

`findNewestMatchingScan(localTrustScanRows, typedClient.domain)` picks the newest scan whose domain matches the brand. With `client_id` the list is already brand-scoped, so the newest row is the answer.

Keep the helper call only if it still does something the scoping does not — check its implementation before deciding. If it becomes a no-op, replace it with the first row and delete the helper if nothing else imports it. State which you did and why.

- [ ] **Step 3: Run the gates**

```bash
npm run test:unit && npm run lint && npx tsc --noEmit
```

- [ ] **Step 4: Remove from the ESLint allowlist and commit**

Delete `"app/\\[lang\\]/dashboard/\\[clientId\\]/page.tsx"` from `SUPABASE_MIGRATION_DEBT`, re-run lint, then:

```bash
git add -A
git commit -m "feat(dashboard): load the brand workspace from Neon

Clicking a brand card led to a page that hung on the deleted Supabase host.
Scans are now filtered by brand, and a database failure renders an error
state rather than a 'brand not found' page.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>"
```

---

## Task 6: Full verification

- [ ] **Step 1: Run everything**

```bash
npm test 2>&1 | grep -v "postgresql://"
```

Expected: unit suite green, integration suite green, all 27 migrations apply to a fresh branch.

- [ ] **Step 2: Confirm the debt list shrank**

```bash
grep -rl "lib/supabase\|@supabase/" --include="*.ts" --include="*.tsx" app lib components scripts
```

Expected remaining: `app/api/fix/route.ts`, `app/api/onboarding/complete/route.ts`, `app/api/scans/[id]/claim/route.ts`, `app/api/stripe/webhook/route.ts`, `app/[lang]/onboarding/page.tsx`, `app/[lang]/dashboard/[clientId]/result/[scanId]/page.tsx`, `lib/localTrust/store.ts`, `lib/reports/store.ts`, plus the two shims — **10 files, down from 13**.

- [ ] **Step 3: Live verification (human)**

Apply `029` to production, deploy, then:
1. Open the brand created in Slice 2 — the workspace renders instead of hanging.
2. Run a scan from that workspace; confirm it appears there.
3. Create a second brand, open it, and confirm the first brand's scan is **not** shown.

Step 3 is the whole point of the slice. Do not mark it done without it.

---

## Definition of done

- `scans.client_id` exists with a composite FK that blocks cross-tenant association, proven by an integration test.
- The workspace and overview API run on `db()` and show only the requested brand's scans.
- A database failure returns 5xx / an error state, never an empty success.
- Three files removed from `SUPABASE_MIGRATION_DEBT`.
- A brand created in the dashboard can be opened and used.
