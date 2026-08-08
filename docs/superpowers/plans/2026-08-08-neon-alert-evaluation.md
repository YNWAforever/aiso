# Neon-native Alert Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the alert cron route's Supabase adapter and RPC dependency with a tested Neon SQL adapter, index-only PostgreSQL migrations, and a safe non-production Neon verification gate.

**Architecture:** Keep `runAlertEvaluation` in `lib/alerts/evaluate.ts` unchanged as the provider-agnostic domain layer. Add `lib/alerts/neon-store.ts` for keyset-paged alert configuration reads, bounded weekly snapshot SQL, Neon Auth email joins, and idempotent notification inserts. Keep the route as a thin composition root that combines the Neon store with Resend.

**Tech Stack:** Next.js 16.2.4, TypeScript 5.9.3, Vitest 4.1.5, `@neondatabase/serverless`, Neon Auth PostgreSQL tables, Resend, PostgreSQL migrations.

## Global Constraints

- Use `DATABASE_URL` and the existing `db()` helper; do not add Supabase credentials to the alert path.
- Keep `lib/alerts/evaluate.ts` and its `AlertEvaluationPorts`, `AlertSnapshot`, `AlertNotificationInput`, and `AlertEmailInput` contracts provider-agnostic.
- Read enabled alert configurations with keyset pagination: `id > lastId`, `ORDER BY id ASC`, `LIMIT 1000`.
- Select one deterministic row per `(client_id, scan_week)` using `created_at DESC NULLS LAST, id DESC`, then retain the latest two weeks per client.
- Join `profiles` to `neon_auth."user"` on the server; choose the first profile per account by `profiles.id ASC`.
- Insert notifications with `ON CONFLICT (client_id, type, scan_week) DO NOTHING`.
- Preserve cron-secret authentication, `{ processed, fired }`, evaluator action ordering, fail-soft notification/email delivery, and hard snapshot-read failures.
- Rewrite unapplied migrations 033 and 034 in place. They may create/drop indexes, but must not create functions or reference `PUBLIC`, `anon`, `authenticated`, or `service_role`.
- Leave unrelated Supabase modules and dependencies unchanged.
- Do not send email, invoke the cron, or mutate a production database during local verification.
- Use `npm.cmd`, local project binaries, and absolute worktree paths in Windows commands.

## File Map

- Modify `C:\Users\laich\Documents\geoscanner\.worktrees\neon-alert-evaluation\supabase\migrations\033_alert_evaluation_hardening.sql`: retain notification and initial snapshot indexes only.
- Modify `C:\Users\laich\Documents\geoscanner\.worktrees\neon-alert-evaluation\supabase\migrations\034_alert_evaluation_snapshot_refinement.sql`: retain the refined snapshot index only.
- Modify `C:\Users\laich\Documents\geoscanner\.worktrees\neon-alert-evaluation\__tests__\supabase\033_alert_evaluation_hardening.test.ts`: assert index-only 033 SQL.
- Modify `C:\Users\laich\Documents\geoscanner\.worktrees\neon-alert-evaluation\__tests__\supabase\034_alert_evaluation_snapshot_refinement.test.ts`: assert index-only 034 SQL.
- Create `C:\Users\laich\Documents\geoscanner\.worktrees\neon-alert-evaluation\lib\alerts\neon-store.ts`: implement the Neon-backed storage ports.
- Create `C:\Users\laich\Documents\geoscanner\.worktrees\neon-alert-evaluation\__tests__\lib\alerts\neon-store.test.ts`: test the adapter with a tagged-template SQL mock.
- Modify `C:\Users\laich\Documents\geoscanner\.worktrees\neon-alert-evaluation\app\api\cron\evaluate-alerts\route.ts`: compose `db()`, the Neon store, Resend, and the evaluator.
- Replace `C:\Users\laich\Documents\geoscanner\.worktrees\neon-alert-evaluation\__tests__\api\cron\evaluate-alerts.test.ts`: test route authentication and composition rather than Supabase internals.
- Leave `C:\Users\laich\Documents\geoscanner\.worktrees\neon-alert-evaluation\lib\alerts\evaluate.ts` and `C:\Users\laich\Documents\geoscanner\.worktrees\neon-alert-evaluation\__tests__\lib\alerts\evaluate.test.ts` unchanged unless a compiler error proves an existing type import must be adjusted.

---

### Task 1: Make migration tests enforce the Neon-safe contract

**Files:**

- Modify: `__tests__/supabase/033_alert_evaluation_hardening.test.ts`
- Modify: `__tests__/supabase/034_alert_evaluation_snapshot_refinement.test.ts`

**Interfaces:**

- Consumes: the current migration files under `supabase/migrations`.
- Produces: failing tests that require the two indexes and reject the removed Supabase function/role statements.

- [ ] **Step 1: Replace the 033 test assertions.** Keep the existing `readFileSync`/`resolve` setup and use this complete test body:

```ts
describe('033_alert_evaluation_hardening.sql', () => {
  it('creates only the notification deduplication and initial snapshot indexes', () => {
    expect(migrationSql).toMatch(
      /DROP INDEX IF EXISTS public\.notifications_dedup_idx;/si,
    )
    expect(migrationSql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedup_idx\s+ON public\.notifications\s*\(\s*client_id,\s*type,\s*scan_week\s*\);/si,
    )
    expect(migrationSql).toMatch(
      /CREATE INDEX IF NOT EXISTS pulse_weekly_summary_alert_snapshot_idx\s+ON public\.pulse_weekly_summary\s*\(\s*client_id,\s*scan_week DESC,\s*id DESC\s*\)\s+WHERE platform IS NULL;/si,
    )
    expect(migrationSql).not.toMatch(
      /get_alert_weekly_snapshot|CREATE OR REPLACE FUNCTION|SECURITY DEFINER|SET search_path|\bGRANT\b|\bREVOKE\b|\banon\b|\bauthenticated\b|\bservice_role\b/i,
    )
  })
})
```

- [ ] **Step 2: Replace the 034 test assertions.** Use this complete test body:

```ts
describe('034_alert_evaluation_snapshot_refinement.sql', () => {
  it('rebuilds only the refined weekly snapshot index', () => {
    expect(migrationSql).toMatch(
      /DROP INDEX IF EXISTS public\.pulse_weekly_summary_alert_snapshot_idx;/si,
    )
    expect(migrationSql).toMatch(
      /CREATE INDEX IF NOT EXISTS pulse_weekly_summary_alert_snapshot_idx\s+ON public\.pulse_weekly_summary\s*\(\s*client_id,\s*scan_week DESC,\s*created_at DESC NULLS LAST,\s*id DESC\s*\)\s+WHERE platform IS NULL;/si,
    )
    expect(migrationSql).not.toMatch(
      /get_alert_weekly_snapshot|CREATE OR REPLACE FUNCTION|SECURITY DEFINER|SET search_path|\bGRANT\b|\bREVOKE\b|\banon\b|\bauthenticated\b|\bservice_role\b/i,
    )
  })
})
```

- [ ] **Step 3: Run the focused migration tests and verify the red state.**

Run:

```powershell
npm.cmd test -- __tests__/supabase/033_alert_evaluation_hardening.test.ts __tests__/supabase/034_alert_evaluation_snapshot_refinement.test.ts
```

Expected: FAIL because the current files still contain `get_alert_weekly_snapshot` and Supabase role grants.

- [ ] **Step 4: Commit the red tests.**

```powershell
git add -- __tests__/supabase/033_alert_evaluation_hardening.test.ts __tests__/supabase/034_alert_evaluation_snapshot_refinement.test.ts
git commit -m "test: require Neon-safe alert migrations"
```

### Task 2: Rewrite migrations 033 and 034 as index-only SQL

**Files:**

- Modify: `supabase/migrations/033_alert_evaluation_hardening.sql`
- Modify: `supabase/migrations/034_alert_evaluation_snapshot_refinement.sql`

**Interfaces:**

- Consumes: the failing static assertions from Task 1.
- Produces: idempotent PostgreSQL index migrations with no alert RPC or Supabase grants.

- [ ] **Step 1: Replace migration 033 with the complete SQL below.**

```sql
-- 033_alert_evaluation_hardening.sql
-- Neon-safe alert indexes. Alert snapshot reads execute in the server adapter.

DROP INDEX IF EXISTS public.notifications_dedup_idx;

CREATE UNIQUE INDEX IF NOT EXISTS notifications_dedup_idx
  ON public.notifications (client_id, type, scan_week);

CREATE INDEX IF NOT EXISTS pulse_weekly_summary_alert_snapshot_idx
  ON public.pulse_weekly_summary (client_id, scan_week DESC, id DESC)
  WHERE platform IS NULL;
```

- [ ] **Step 2: Replace migration 034 with the complete SQL below.**

```sql
-- 034_alert_evaluation_snapshot_refinement.sql
-- Refine the Neon alert snapshot index with deterministic tie-break columns.

DROP INDEX IF EXISTS public.pulse_weekly_summary_alert_snapshot_idx;

CREATE INDEX IF NOT EXISTS pulse_weekly_summary_alert_snapshot_idx
  ON public.pulse_weekly_summary (
    client_id,
    scan_week DESC,
    created_at DESC NULLS LAST,
    id DESC
  )
  WHERE platform IS NULL;
```

- [ ] **Step 3: Run the migration tests and verify the green state.**

Run:

```powershell
npm.cmd test -- __tests__/supabase/033_alert_evaluation_hardening.test.ts __tests__/supabase/034_alert_evaluation_snapshot_refinement.test.ts
```

Expected: PASS with both files asserting the required indexes and zero forbidden function/role matches.

- [ ] **Step 4: Commit the migration correction.**

```powershell
git add -- supabase/migrations/033_alert_evaluation_hardening.sql supabase/migrations/034_alert_evaluation_snapshot_refinement.sql
git commit -m "fix: make alert migrations Neon-safe"
```

### Task 3: Add failing Neon adapter tests

**Files:**

- Create: `__tests__/lib/alerts/neon-store.test.ts`

**Interfaces:**

- Consumes: `AlertSnapshot`, `AlertNotificationInput`, and `NeonQueryFunction<false, false>`.
- Produces: the required `createNeonAlertStore(sql)` behavior for Task 4.

- [ ] **Step 1: Add the tagged-template SQL test harness and behavior tests.** Create the file with this complete test structure; the responder returns rows based on the SQL text, so no database or credentials are needed:

```ts
import { describe, expect, it, vi } from 'vitest'
import type { NeonQueryFunction } from '@neondatabase/serverless'
import type { AlertNotificationInput } from '@/lib/alerts/evaluate'
import { createNeonAlertStore } from '@/lib/alerts/neon-store'

type SqlCall = { text: string; params: unknown[] }
type SqlResponder = (call: SqlCall) => unknown[] | Promise<unknown[]>

function makeSql(respond: SqlResponder) {
  const calls: SqlCall[] = []
  const sql = vi.fn(async (strings: TemplateStringsArray, ...params: unknown[]) => {
    const text = strings.reduce(
      (result, part, index) => `${result}${part}${index < params.length ? `$${index + 1}` : ''}`,
      '',
    )
    const call = { text, params }
    calls.push(call)
    return respond(call)
  }) as unknown as NeonQueryFunction<false, false>

  return { sql, calls }
}

function configRow(id = 'alert-1') {
  return {
    id,
    client_id: 'client-1',
    enabled_sov: true,
    sov_threshold: 50,
    enabled_wow: true,
    wow_threshold: 10,
    notify_email: true,
    notify_inapp: true,
    created_at: null,
    updated_at: null,
    joined_client_id: 'client-1',
    joined_brand_name: 'Acme',
    joined_account_id: 'account-1',
  }
}

function notification(): AlertNotificationInput {
  return {
    account_id: 'account-1',
    client_id: 'client-1',
    type: 'sov_threshold',
    title: 'SoV alert',
    message: 'Current score is below threshold.',
    read: false,
    scan_week: '2026-08-08',
  }
}

describe('createNeonAlertStore', () => {
  it('pages config rows at 1000 using the last returned id', async () => {
    let configCalls = 0
    const { sql, calls } = makeSql(({ text }) => {
      const normalized = text.toLowerCase()
      if (normalized.includes('from public.alert_configs')) {
        configCalls += 1
        if (configCalls === 1) {
          return Array.from({ length: 1000 }, (_, index) => configRow(`alert-${index + 1}`))
        }
        if (configCalls === 2) return [configRow('alert-1001')]
        return []
      }
      if (normalized.includes('from public.pulse_weekly_summary')) {
        return [{ client_id: 'client-1', scan_week: '2026-08-08', sov_score: '40' }]
      }
      if (normalized.includes('from public.profiles')) {
        return [{ account_id: 'account-1', email: 'owner@example.com' }]
      }
      throw new Error(`unexpected SQL: ${text}`)
    })

    const snapshot = await createNeonAlertStore(sql).loadSnapshot()
    const configSqlCalls = calls.filter(call => call.text.toLowerCase().includes('from public.alert_configs'))

    expect(snapshot.configs).toHaveLength(1001)
    expect(configSqlCalls).toHaveLength(3)
    expect(configSqlCalls.every(call => call.params.length > 0)).toBe(true)
    expect(configSqlCalls[0].params).toContain(1000)
    expect(configSqlCalls[1].params).toContain('alert-1000')
  })

  it('normalizes numeric scores, preserves null scores, and joins Neon Auth email deterministically', async () => {
    const { sql, calls } = makeSql(({ text }) => {
      const normalized = text.toLowerCase()
      if (normalized.includes('from public.alert_configs')) return [configRow()]
      if (normalized.includes('from public.pulse_weekly_summary')) {
        return [
          { client_id: 'client-1', scan_week: '2026-08-08', sov_score: '41.5' },
          { client_id: 'client-1', scan_week: '2026-08-01', sov_score: null },
        ]
      }
      if (normalized.includes('from public.profiles')) {
        return [{ account_id: 'account-1', email: 'owner@example.com' }]
      }
      throw new Error(`unexpected SQL: ${text}`)
    })

    const snapshot = await createNeonAlertStore(sql).loadSnapshot()
    const weeklySql = calls.find(call => call.text.toLowerCase().includes('from public.pulse_weekly_summary'))
    const profileSql = calls.find(call => call.text.toLowerCase().includes('from public.profiles'))

    expect(snapshot.weeksByClient['client-1']).toEqual([
      { client_id: 'client-1', scan_week: '2026-08-08', sov_score: 41.5 },
      { client_id: 'client-1', scan_week: '2026-08-01', sov_score: null },
    ])
    expect(snapshot.emailsByAccount).toEqual({ 'account-1': 'owner@example.com' })
    expect(weeklySql?.text).toMatch(/DISTINCT ON\s*\(summary\.client_id,\s*summary\.scan_week\)/i)
    expect(weeklySql?.text).toMatch(/created_at DESC NULLS LAST,\s*summary\.id DESC/i)
    expect(profileSql?.text).toMatch(/neon_auth\."user"/i)
    expect(profileSql?.text).toMatch(/DISTINCT ON\s*\(p\.account_id\)/i)
  })

  it('uses the notification conflict target and treats the insert as a no-op result', async () => {
    const { sql, calls } = makeSql(() => [])

    await createNeonAlertStore(sql).upsertNotification(notification())

    expect(calls).toHaveLength(1)
    expect(calls[0].text).toMatch(
      /ON CONFLICT\s*\(client_id,\s*type,\s*scan_week\)\s*DO NOTHING/i,
    )
    expect(calls[0].params).toEqual(expect.arrayContaining([
      'account-1',
      'client-1',
      'sov_threshold',
      'SoV alert',
      'Current score is below threshold.',
      false,
      '2026-08-08',
    ]))
  })

  it('propagates weekly snapshot read failures', async () => {
    const { sql } = makeSql(({ text }) => {
      if (text.toLowerCase().includes('from public.alert_configs')) return [configRow()]
      if (text.toLowerCase().includes('from public.pulse_weekly_summary')) {
        throw new Error('snapshot unavailable')
      }
      return []
    })

    await expect(createNeonAlertStore(sql).loadSnapshot()).rejects.toThrow('snapshot unavailable')
  })
})
```

- [ ] **Step 2: Run the new adapter test to confirm the red state.**

Run:

```powershell
npm.cmd test -- __tests__/lib/alerts/neon-store.test.ts
```

Expected: FAIL because `lib/alerts/neon-store.ts` does not exist yet.

- [ ] **Step 3: Commit the failing adapter tests.**

```powershell
git add -- __tests__/lib/alerts/neon-store.test.ts
git commit -m "test: define Neon alert store contract"
```

### Task 4: Implement the Neon alert store

**Files:**

- Create: `lib/alerts/neon-store.ts`

**Interfaces:**

- Consumes: `NeonQueryFunction<false, false>` from `@neondatabase/serverless`.
- Produces: `createNeonAlertStore(sql): Pick<AlertEvaluationPorts, 'loadSnapshot' | 'upsertNotification'>`.

- [ ] **Step 1: Implement the store with the following complete query and normalization structure.** Keep all SQL in this server-only module:

```ts
import type { NeonQueryFunction } from '@neondatabase/serverless'
import {
  type AlertConfigWithClient,
  type AlertEvaluationPorts,
  type AlertNotificationInput,
  type AlertSnapshot,
  type AlertWeekSnapshot,
} from '@/lib/alerts/evaluate'

const PAGE_SIZE = 1000
type Sql = NeonQueryFunction<false, false>

type AlertConfigRow = {
  id: string
  client_id: string
  enabled_sov: boolean
  sov_threshold: number | string
  enabled_wow: boolean
  wow_threshold: number | string
  notify_email: boolean
  notify_inapp: boolean
  created_at: string | null
  updated_at: string | null
  joined_client_id: string
  joined_brand_name: string
  joined_account_id: string
}

type WeeklyRow = {
  client_id: string
  scan_week: string | Date
  sov_score: number | string | null
}

type EmailRow = {
  account_id: string
  email: string | null
}

export type NeonAlertStore = Pick<AlertEvaluationPorts, 'loadSnapshot' | 'upsertNotification'>

export function createNeonAlertStore(sql: Sql): NeonAlertStore {
  return {
    loadSnapshot: () => loadSnapshot(sql),
    upsertNotification: notification => upsertNotification(sql, notification),
  }
}

async function loadSnapshot(sql: Sql): Promise<AlertSnapshot> {
  const configs = await loadConfigs(sql)
  if (!configs.length) {
    return {
      configs: [],
      weeksByClient: {},
      emailsByAccount: {},
      dashboardUrlByClient: {},
    }
  }

  const clientIds = [...new Set(configs.map(config => config.client_id))]
  const accountIds = [...new Set(configs.map(config => config.client.account_id))]
  const [weeklyRows, emailRows] = await Promise.all([
    loadWeeklyRows(sql, clientIds),
    loadEmailRows(sql, accountIds),
  ])

  const weeksByClient: Record<string, AlertWeekSnapshot[]> = {}
  for (const row of weeklyRows) {
    const week = {
      client_id: row.client_id,
      scan_week: row.scan_week instanceof Date
        ? row.scan_week.toISOString().slice(0, 10)
        : row.scan_week,
      sov_score: row.sov_score === null ? null : Number(row.sov_score),
    }
    weeksByClient[row.client_id] = [...(weeksByClient[row.client_id] ?? []), week]
  }

  return {
    configs,
    weeksByClient,
    emailsByAccount: Object.fromEntries(
      emailRows.map(row => [row.account_id, row.email]),
    ),
    dashboardUrlByClient: Object.fromEntries(
      configs.map(config => [
        config.client_id,
        `${process.env.NEXT_PUBLIC_APP_URL}/en/dashboard/${config.client_id}`,
      ]),
    ),
  }
}

async function loadConfigs(sql: Sql): Promise<AlertConfigWithClient[]> {
  const configs: AlertConfigWithClient[] = []
  let lastId: string | null = null

  for (;;) {
    const rows = await sql<AlertConfigRow>`
      SELECT
        ac.id,
        ac.client_id,
        ac.enabled_sov,
        ac.sov_threshold,
        ac.enabled_wow,
        ac.wow_threshold,
        ac.notify_email,
        ac.notify_inapp,
        ac.created_at,
        ac.updated_at,
        c.id AS joined_client_id,
        c.brand_name AS joined_brand_name,
        c.account_id AS joined_account_id
      FROM public.alert_configs AS ac
      INNER JOIN public.clients AS c ON c.id = ac.client_id
      WHERE (ac.enabled_sov = TRUE OR ac.enabled_wow = TRUE)
        AND (${lastId === null} OR ac.id > ${lastId})
      ORDER BY ac.id ASC
      LIMIT ${PAGE_SIZE}
    `
    if (!rows.length) break

    for (const row of rows) {
      configs.push({
        id: row.id,
        client_id: row.client_id,
        enabled_sov: Boolean(row.enabled_sov),
        sov_threshold: Number(row.sov_threshold),
        enabled_wow: Boolean(row.enabled_wow),
        wow_threshold: Number(row.wow_threshold),
        notify_email: Boolean(row.notify_email),
        notify_inapp: Boolean(row.notify_inapp),
        created_at: row.created_at ?? undefined,
        updated_at: row.updated_at ?? undefined,
        client: {
          id: row.joined_client_id,
          brand_name: row.joined_brand_name,
          account_id: row.joined_account_id,
        },
      })
    }
    lastId = rows[rows.length - 1].id
  }

  return configs
}

async function loadWeeklyRows(sql: Sql, clientIds: string[]): Promise<WeeklyRow[]> {
  return sql<WeeklyRow>`
    WITH latest_distinct_weeks AS (
      SELECT DISTINCT ON (summary.client_id, summary.scan_week)
        summary.client_id,
        summary.scan_week,
        summary.sov_score
      FROM public.pulse_weekly_summary AS summary
      WHERE summary.platform IS NULL
        AND summary.client_id = ANY(${clientIds}::uuid[])
      ORDER BY
        summary.client_id,
        summary.scan_week DESC,
        summary.created_at DESC NULLS LAST,
        summary.id DESC
    ), ranked AS (
      SELECT
        latest_distinct_weeks.client_id,
        latest_distinct_weeks.scan_week,
        latest_distinct_weeks.sov_score,
        row_number() OVER (
          PARTITION BY latest_distinct_weeks.client_id
          ORDER BY latest_distinct_weeks.scan_week DESC
        ) AS row_number
      FROM latest_distinct_weeks
    )
    SELECT client_id, scan_week, sov_score
    FROM ranked
    WHERE row_number <= 2
    ORDER BY client_id, row_number ASC
  `
}

async function loadEmailRows(sql: Sql, accountIds: string[]): Promise<EmailRow[]> {
  return sql<EmailRow>`
    SELECT DISTINCT ON (p.account_id)
      p.account_id,
      u.email
    FROM public.profiles AS p
    LEFT JOIN neon_auth."user" AS u ON u.id = p.id
    WHERE p.account_id = ANY(${accountIds}::uuid[])
    ORDER BY p.account_id ASC, p.id ASC
  `
}

async function upsertNotification(sql: Sql, notification: AlertNotificationInput) {
  await sql`
    INSERT INTO public.notifications (
      account_id,
      client_id,
      type,
      title,
      message,
      read,
      scan_week
    ) VALUES (
      ${notification.account_id},
      ${notification.client_id},
      ${notification.type},
      ${notification.title},
      ${notification.message},
      ${notification.read},
      ${notification.scan_week}
    )
    ON CONFLICT (client_id, type, scan_week) DO NOTHING
  `
}
```

- [ ] **Step 2: Run adapter tests and fix only type or SQL-shape failures.**

Run:

```powershell
npm.cmd test -- __tests__/lib/alerts/neon-store.test.ts __tests__/lib/alerts/evaluate.test.ts
```

Expected: PASS for the new store tests and all existing evaluator tests. The evaluator file must remain unchanged.

- [ ] **Step 3: Commit the Neon store.**

```powershell
git add -- lib/alerts/neon-store.ts __tests__/lib/alerts/neon-store.test.ts
git commit -m "feat: add Neon alert evaluation store"
```

### Task 5: Replace the cron route's provider-specific composition

**Files:**

- Modify: `app/api/cron/evaluate-alerts/route.ts`
- Replace: `__tests__/api/cron/evaluate-alerts.test.ts`

**Interfaces:**

- Consumes: `db()`, `createNeonAlertStore(sql)`, `runAlertEvaluation`, and `sendAlertEmail`.
- Produces: the existing cron endpoint response with no Supabase import or RPC call.

- [ ] **Step 1: Replace the route test with the following focused composition tests.**

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  db: vi.fn(),
  createNeonAlertStore: vi.fn(),
  runAlertEvaluation: vi.fn(),
  sendAlertEmail: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: h.db }))
vi.mock('@/lib/alerts/neon-store', () => ({ createNeonAlertStore: h.createNeonAlertStore }))
vi.mock('@/lib/alerts/evaluate', () => ({ runAlertEvaluation: h.runAlertEvaluation }))
vi.mock('@/lib/resend', () => ({ sendAlertEmail: h.sendAlertEmail }))

async function importRoute() {
  vi.resetModules()
  return import('@/app/api/cron/evaluate-alerts/route')
}

function request(secret?: string) {
  return new Request('https://app.example/api/cron/evaluate-alerts', {
    headers: secret ? { 'x-cron-secret': secret } : {},
  })
}

describe('POST /api/cron/evaluate-alerts', () => {
  const originalCronSecret = process.env.CRON_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'
    h.db.mockReturnValue('sql')
    h.createNeonAlertStore.mockReturnValue({
      loadSnapshot: vi.fn(),
      upsertNotification: vi.fn(),
    })
    h.runAlertEvaluation.mockResolvedValue({ processed: 3, fired: 2 })
  })

  afterEach(() => {
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = originalCronSecret
  })

  it('returns 500 when CRON_SECRET is not configured', async () => {
    delete process.env.CRON_SECRET
    const { POST } = await importRoute()

    const response = await POST(request('test-cron-secret'))

    expect(response.status).toBe(500)
    expect(h.db).not.toHaveBeenCalled()
  })

  it('returns 401 for a missing or incorrect cron secret', async () => {
    const { POST } = await importRoute()

    const response = await POST(request('wrong-secret'))

    expect(response.status).toBe(401)
    expect(h.db).not.toHaveBeenCalled()
    expect(h.runAlertEvaluation).not.toHaveBeenCalled()
  })

  it('composes Neon storage and Resend after authentication', async () => {
    const store = {
      loadSnapshot: vi.fn(),
      upsertNotification: vi.fn(),
    }
    h.createNeonAlertStore.mockReturnValue(store)
    const { POST } = await importRoute()

    const response = await POST(request('test-cron-secret'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ processed: 3, fired: 2 })
    expect(h.db).toHaveBeenCalledOnce()
    expect(h.createNeonAlertStore).toHaveBeenCalledWith('sql')
    expect(h.runAlertEvaluation).toHaveBeenCalledWith({
      ...store,
      sendAlertEmail: h.sendAlertEmail,
    })
  })
})
```

- [ ] **Step 2: Run the route test to verify the red state.**

Run:

```powershell
npm.cmd test -- __tests__/api/cron/evaluate-alerts.test.ts
```

Expected: FAIL because the current route still imports `@supabase/supabase-js` and does not call `db()` or `createNeonAlertStore`.

- [ ] **Step 3: Replace the route with the thin Neon composition.** Keep the current missing-secret and unauthorized branches exactly, and use this implementation shape for the authenticated branch:

```ts
import {
  runAlertEvaluation,
  type AlertEvaluationPorts,
} from '@/lib/alerts/evaluate'
import { createNeonAlertStore } from '@/lib/alerts/neon-store'
import { db } from '@/lib/db'
import { sendAlertEmail as deliverAlertEmail } from '@/lib/resend'

export async function POST(req: Request) {
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) {
    console.error('evaluate-alerts: CRON_SECRET env var is not set')
    return Response.json({ error: 'Cron not configured' }, { status: 500 })
  }

  const incomingSecret = req.headers.get('x-cron-secret')
  if (!incomingSecret || incomingSecret !== cronSecret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const ports: AlertEvaluationPorts = {
    ...createNeonAlertStore(db()),
    sendAlertEmail: deliverAlertEmail,
  }
  const result = await runAlertEvaluation(ports)

  return Response.json(result)
}
```

- [ ] **Step 4: Run the route, adapter, and evaluator tests.**

Run:

```powershell
npm.cmd test -- __tests__/api/cron/evaluate-alerts.test.ts __tests__/lib/alerts/neon-store.test.ts __tests__/lib/alerts/evaluate.test.ts
```

Expected: PASS; no test should mock or import `@supabase/supabase-js` for this route.

- [ ] **Step 5: Commit the route correction.**

```powershell
git add -- app/api/cron/evaluate-alerts/route.ts __tests__/api/cron/evaluate-alerts.test.ts
git commit -m "fix: compose alert evaluation through Neon"
```

### Task 6: Run local verification and review the diff

**Files:**

- Verify: all files changed by Tasks 1–5.
- Do not modify: unrelated Supabase modules, `lib/alerts/evaluate.ts`, or package dependencies.

**Interfaces:**

- Consumes: the completed Neon adapter, route, tests, and migrations.
- Produces: a locally verified branch ready for a separate Neon branch gate.

- [ ] **Step 1: Run the focused alert test set.**

```powershell
npm.cmd test -- __tests__/api/cron/evaluate-alerts.test.ts __tests__/lib/alerts/neon-store.test.ts __tests__/lib/alerts/evaluate.test.ts __tests__/supabase/033_alert_evaluation_hardening.test.ts __tests__/supabase/034_alert_evaluation_snapshot_refinement.test.ts
```

Expected: PASS for all focused files.

- [ ] **Step 2: Run the complete Vitest suite.**

```powershell
npm.cmd test
```

Expected: PASS with no failures in existing unrelated test files.

- [ ] **Step 3: Run TypeScript, lint, and build independently.**

```powershell
npm.cmd exec -- tsc -- --noEmit
npm.cmd run lint
npm.cmd run build
```

Expected: TypeScript exits 0, ESLint exits 0, and Next.js build exits 0. Report a failure by command; do not collapse an environment/tooling failure into a source-pass claim.

- [ ] **Step 4: Check formatting, scope, and provider boundaries.**

```powershell
git diff --check
git status --short --branch
git diff --name-only main...HEAD
rg -n "@supabase/supabase-js|createClient|\.rpc\(|get_alert_weekly_snapshot|SUPABASE_SERVICE_ROLE_KEY|NEXT_PUBLIC_SUPABASE_URL" app/api/cron/evaluate-alerts lib/alerts/neon-store.ts __tests__/api/cron/evaluate-alerts.test.ts __tests__/lib/alerts/neon-store.test.ts
```

Expected: the final `rg` command returns no alert-path Supabase references; implementation changes are limited to the planned route, store, tests, and migrations, while the already committed specification/plan documents remain intentional. Preserve the unrelated untracked `.codebase-memory/` directory.

- [ ] **Step 5: Commit the verified implementation.**

```powershell
git add -- app/api/cron/evaluate-alerts/route.ts lib/alerts/neon-store.ts __tests__/api/cron/evaluate-alerts.test.ts __tests__/lib/alerts/neon-store.test.ts __tests__/supabase/033_alert_evaluation_hardening.test.ts __tests__/supabase/034_alert_evaluation_snapshot_refinement.test.ts supabase/migrations/033_alert_evaluation_hardening.sql supabase/migrations/034_alert_evaluation_snapshot_refinement.sql
git commit -m "fix: migrate alert evaluation to Neon"
```

### Task 7: Verify migrations on a dedicated non-production Neon branch

**Files:**

- Read: `supabase/migrations/033_alert_evaluation_hardening.sql`
- Read: `supabase/migrations/034_alert_evaluation_snapshot_refinement.sql`
- Do not modify repository files or production data in this task.

**Interfaces:**

- Consumes: verified migration SQL, Neon project `red-firefly-93523049`, production parent branch `br-rough-butterfly-aojtgi92`, and the approved branch name `preview-alert-evaluation`.
- Produces: read-only evidence from the dedicated branch; it does not produce a production migration.

- [ ] **Step 1: Stop for an explicit external-mutation approval.** Before creating the branch or running DDL, show the user the target project, branch name, parent branch, exact migration files, and that the existing `preview-pro-client-reports` branch will not be used. Do not use `complete_database_migration` because this task's target is the dedicated non-production branch, not production.

- [ ] **Step 2: Create the dedicated branch only after approval.** Use the Neon MCP action with:

```ts
await tools.mcp__neon__create_branch({
  projectId: 'red-firefly-93523049',
  branchName: 'preview-alert-evaluation',
  parentId: 'br-rough-butterfly-aojtgi92',
})
```

Record the returned branch ID and database name. If a branch with that name already exists, inspect it with `describe_branch` and stop rather than deleting or reusing it without user direction.

- [ ] **Step 3: Apply migration 033, then 034, to that branch only.** Use `mcp__neon__run_sql_transaction` with the exact statements from 033 in order, then a separate transaction with the exact statements from 034. Pass the dedicated `branchId`, project ID, and database name on every call. Obtain user confirmation for the DDL execution before invoking either transaction.

- [ ] **Step 4: Verify schema and behavior with read-only SQL.** Use `mcp__neon__run_sql` against the dedicated branch for these checks:

```sql
SELECT indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND indexname IN ('notifications_dedup_idx', 'pulse_weekly_summary_alert_snapshot_idx')
ORDER BY indexname;

SELECT routine_schema, routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_name = 'get_alert_weekly_snapshot';

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'neon_auth'
  AND table_name = 'user'
  AND column_name IN ('id', 'email')
ORDER BY column_name;

WITH latest_distinct_weeks AS (
  SELECT DISTINCT ON (summary.client_id, summary.scan_week)
    summary.client_id,
    summary.scan_week,
    summary.sov_score
  FROM public.pulse_weekly_summary AS summary
  WHERE summary.platform IS NULL
  ORDER BY summary.client_id, summary.scan_week DESC,
    summary.created_at DESC NULLS LAST, summary.id DESC
), ranked AS (
  SELECT latest_distinct_weeks.*,
    row_number() OVER (
      PARTITION BY client_id ORDER BY scan_week DESC
    ) AS row_number
  FROM latest_distinct_weeks
)
SELECT client_id, scan_week, sov_score
FROM ranked
WHERE row_number <= 2
ORDER BY client_id, row_number;
```

Expected: both indexes exist with the intended definitions; the alert RPC query returns zero rows; `neon_auth.user` exposes `id` and `email`; the snapshot query returns no more than two rows per client and one row per week. If there are no fixture rows, report that fact separately from the schema evidence.

- [ ] **Step 5: Stop before production.** Do not invoke the cron and do not call `complete_database_migration` or any production-targeted DDL. Request a separate explicit approval if the user wants a production migration.

## Plan Self-Review

- Spec coverage: Neon adapter, direct SQL, pagination, deterministic profile/email selection, nullable scores, notification idempotency, route composition, migration rewrite, focused tests, full verification, and non-production branch gates each have an explicit task.
- Placeholder scan: the plan contains no unresolved placeholder markers or deferred implementation step; every code change has a concrete file, command, expected result, and code shape.
- Type consistency: Task 3 defines `createNeonAlertStore(sql)` and the `NeonQueryFunction<false, false>` test seam; Task 4 implements that exact factory; Task 5 composes its exact storage return type into the existing `AlertEvaluationPorts` contract.
- Safety review: all external DDL is gated to the named branch and explicit approval; no production completion or cron invocation is included.
