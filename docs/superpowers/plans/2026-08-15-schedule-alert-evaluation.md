# Schedule Alert Evaluation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the already-built alert evaluator actually run on a schedule, exactly once per week per alert, and stop advertising SoV alerts as "coming soon" once it does.

**Architecture:** `lib/alerts/evaluate.ts` (the evaluator) and `lib/alerts/neon-store.ts` (its Neon data layer) already work and are unit-tested. Three things stop them from operating: (1) the cron route exports only `POST` and reads only an `x-cron-secret` header, while Vercel Cron issues `GET` with `Authorization: Bearer $CRON_SECRET`; (2) `vercel.json` schedules nothing for it; (3) email sending has no idempotence, so any re-run re-sends every alert email even though the in-app notification insert correctly no-ops. This plan adds a `GET` handler beside the existing `POST`, adds an email delivery ledger table so email gets the same once-per-week guarantee notifications already have, schedules the cron, and flips `release.sovAlerts` to `available`.

**Tech Stack:** Next.js 16 App Router route handlers, Neon serverless Postgres (`db()` from `@/lib/db`, tagged-template SQL only), Resend, Vitest.

---

## Before you start: read this section fully

**This plan does not touch production.** Applying migrations and deploying are ops steps for a human with production access, listed at the end in Task 8. Do not run `npm run migrate` against a production database, do not invoke the cron route against production, and do not send email traffic from local review. `docs/alert-evaluation-release.md` says the same and is the release gate.

**Deployment is blocked until migrations `033`, `034` and the new `035` are applied to the production Neon database.** `033` creates the unique index that the notification `ON CONFLICT` write needs — without it that insert errors rather than dedupes. `035` (this plan) creates the email ledger — without it every email send errors. Per `CLAUDE.md`, `033` and `034` are believed pending. Task 8 covers verification.

**Three corrections to expectations you may have picked up from the status/roadmap doc:**

1. **`cron/evaluate-alerts` is not fenced.** It is not in `__tests__/api/fenced-routes.test.ts` and does not import `lib/unavailable.ts`. There is no fence entry to delete. Do not go looking for one.
2. **No separate driver route is needed.** `cron/pulse` exists as a driver because `pulse/run` is chunked and re-entrant — one invocation cannot finish a week's work inside the 60s ceiling, so the driver chains hops via `after()`. Alert evaluation is a single bounded pass over alert configs with no chunking, so a second route plus an internal `fetch` would add failure modes (origin resolution, an extra invocation, a 502 path) and buy nothing. Add `GET` to the existing route instead.
3. **The existing `POST` handler stays.** `docs/alert-evaluation-release.md`'s smoke checks invoke the route manually, and `x-cron-secret` is the shape for that. `GET` is for Vercel Cron; `POST` is for operators.

**Why the email ledger is a new table rather than reuse of `notifications`:** `alert_configs.notify_inapp` defaults to true but is user-settable (`supabase/migrations/010_phase3b.sql:11`), and `buildAction` returns `notification: null` when it is false. So an email-only config writes no notifications row, and the notifications dedup index cannot serve as the email ledger. Overloading the notifications table (writing rows a user opted out of seeing, purely as a ledger) would also hand a bug to whoever restores the notifications read surface later. A dedicated ledger keeps `notifications` meaning "things to show the user". The repo has precedent: `stripe_webhook_events` in migration `024` is the same shape of idempotence ledger.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `supabase/migrations/035_alert_email_delivery_ledger.sql` | One row per delivered alert email, uniquely keyed `(client_id, type, scan_week)` | Create |
| `__tests__/supabase/035_alert_email_delivery_ledger.test.ts` | Asserts the migration's shape and that it uses no Supabase-era roles | Create |
| `lib/alerts/evaluate.ts` | Evaluator + ports interface. Gains `claimEmailDelivery` / `releaseEmailDelivery` ports and a claim-before-send email path | Modify |
| `lib/alerts/neon-store.ts` | Neon implementations of the two new ports | Modify |
| `app/api/cron/evaluate-alerts/route.ts` | Gains a `GET` handler authenticating Vercel Cron's Bearer header; keeps `POST` | Modify |
| `vercel.json` | Schedules `/api/cron/evaluate-alerts`, declares its `maxDuration` | Modify |
| `lib/plans/catalog.ts` | `release.sovAlerts` flips `planned` → `available` on pro and enterprise | Modify |
| `docs/alert-evaluation-release.md` | Adds `035` and the post-schedule verification steps | Modify |
| `CLAUDE.md`, `README.md` | Record that alerts are scheduled and that `035` exists | Modify |
| `__tests__/lib/alerts/evaluate.test.ts` | Extend `portsFor` with the new ports; add dedupe and release-on-failure tests | Modify |
| `__tests__/lib/alerts/neon-store.test.ts` | Tests for the two new store methods | Modify |
| `__tests__/api/cron/evaluate-alerts.test.ts` | Tests for the `GET` handler's auth and composition | Modify |
| `__tests__/config/function-durations.test.ts` | Pin the new crons array; assert alerts runs after the rollup it reads | Modify |
| `__tests__/lib/plans/alerts-release.test.ts` | Pins the release state and its coupling to the scheduled cron | Create |

**Commands you will use throughout.** Run from the repo root.

```bash
npx vitest run __tests__/path/to/file.test.ts
```

```bash
npm run lint
```

```bash
npm run typecheck
```

Do not use `npm run test:unit` for single-file iteration — it runs all 134 files. Use it once at the end (Task 7).

---

### Task 1: Email delivery ledger migration

**Files:**
- Create: `supabase/migrations/035_alert_email_delivery_ledger.sql`
- Test: `__tests__/supabase/035_alert_email_delivery_ledger.test.ts`

Migration tests in this repo assert on the SQL text, not on a live database. Copy the shape of `__tests__/supabase/033_alert_evaluation_hardening.test.ts`.

- [ ] **Step 1: Write the failing test**

Create `__tests__/supabase/035_alert_email_delivery_ledger.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const migrationSql = readFileSync(
  resolve(process.cwd(), 'supabase/migrations/035_alert_email_delivery_ledger.sql'),
  'utf8',
)

describe('035_alert_email_delivery_ledger.sql', () => {
  it('keys the ledger so one email can be sent per client, type and week', () => {
    expect(migrationSql).toMatch(
      /CREATE TABLE IF NOT EXISTS public\.alert_email_deliveries/i,
    )
    expect(migrationSql).toMatch(
      /CREATE UNIQUE INDEX IF NOT EXISTS alert_email_deliveries_dedup_idx\s+ON public\.alert_email_deliveries\s*\(\s*client_id,\s*type,\s*scan_week\s*\);/si,
    )
  })

  it('constrains type to the three alert types the evaluator emits', () => {
    // Same three the notifications CHECK allows (010_phase3b.sql:32). A fourth
    // alert type has to be added in both places or the ledger insert throws
    // after the notification insert has already succeeded.
    expect(migrationSql).toMatch(
      /CHECK \(type IN \('sov_threshold', 'sov_wow_drop', 'sov_recovery'\)\)/i,
    )
  })

  it('cascades with the client, so deleting a brand cannot strand ledger rows', () => {
    expect(migrationSql).toMatch(
      /client_id\s+uuid NOT NULL REFERENCES public\.clients\(id\) ON DELETE CASCADE/i,
    )
  })

  it('uses nothing Neon does not have', () => {
    // 027 had to be rewritten because it granted to the Supabase roles
    // anon / authenticated / service_role and called gen_random_bytes()
    // without enabling pgcrypto. None of those exist under Neon.
    // gen_random_uuid() is core PostgreSQL 13+ and is fine.
    expect(migrationSql).not.toMatch(
      /\bGRANT\b|\bREVOKE\b|\banon\b|\bauthenticated\b|\bservice_role\b|gen_random_bytes/i,
    )
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/supabase/035_alert_email_delivery_ledger.test.ts`

Expected: FAIL — `ENOENT: no such file or directory` for `035_alert_email_delivery_ledger.sql`. The failure is at module load, so all four tests fail together.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/035_alert_email_delivery_ledger.sql`:

```sql
-- 035_alert_email_delivery_ledger.sql
-- One alert email per (client, type, scan_week).
--
-- notifications already dedupes in-app rows through notifications_dedup_idx
-- (033), but email had no equivalent: runAlertEvaluation called sendAlertEmail
-- for every fired action, so re-running evaluation within the same week re-sent
-- every email while the notification insert correctly no-opped. Alert configs
-- can set notify_inapp = false (010_phase3b.sql:11), in which case no
-- notifications row is written at all, so that table cannot serve as the email
-- ledger even when it is present.
--
-- No RLS. The 21 leftover Supabase-era policies on other tables are inert --
-- the app connects as neondb_owner, which bypasses RLS -- so enabling it here
-- would add a dead policy rather than a control. Tenancy is enforced in the
-- query, as everywhere else.

CREATE TABLE IF NOT EXISTS public.alert_email_deliveries (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id  uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  type       text NOT NULL CHECK (type IN ('sov_threshold', 'sov_wow_drop', 'sov_recovery')),
  scan_week  date NOT NULL,
  recipient  text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS alert_email_deliveries_dedup_idx
  ON public.alert_email_deliveries (client_id, type, scan_week);
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/supabase/035_alert_email_delivery_ledger.test.ts`

Expected: PASS, 4 tests.

- [ ] **Step 5: Verify the migration runner can see the new relations**

Run: `npx vitest run __tests__/scripts/`

Expected: PASS. `scripts/migrate.ts` parses `CREATE TABLE` and `CREATE INDEX` statements to build its `--verify` and `--baseline` guard lists, so a malformed statement here would surface as a script-test failure. If `__tests__/scripts/` contains no migration-parsing test, this step passes trivially — that is fine, move on.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/035_alert_email_delivery_ledger.sql __tests__/supabase/035_alert_email_delivery_ledger.test.ts
git commit -m "feat(alerts): add the email delivery ledger table"
```

---

### Task 2: Neon store ports for claiming and releasing an email delivery

**Files:**
- Modify: `lib/alerts/evaluate.ts` (type + ports interface only; the send path changes in Task 3)
- Modify: `lib/alerts/neon-store.ts`
- Test: `__tests__/lib/alerts/neon-store.test.ts`

The store test fakes the tagged-template `sql` function and asserts on the generated SQL text and params — see `makeSql` at the top of the existing file.

- [ ] **Step 1: Add the delivery-key type and the two ports to the interface**

In `lib/alerts/evaluate.ts`, add this type immediately after the `AlertEmailInput` interface (which ends at line 38):

```ts
/**
 * Identity of one alert email, matching alert_email_deliveries' unique index.
 *
 * Separate from AlertEmailInput because the ledger keys on the week while the
 * email body does not mention it.
 */
export interface AlertEmailDeliveryKey {
  client_id: string
  type: AlertType
  scan_week: string
  recipient: string
}
```

Then replace the `AlertEvaluationPorts` interface (lines 40-44) with:

```ts
export interface AlertEvaluationPorts {
  loadSnapshot: () => Promise<AlertSnapshot>
  upsertNotification: (notification: AlertNotificationInput) => Promise<void>
  /** Insert the ledger row. Returns false when this email already went out. */
  claimEmailDelivery: (key: AlertEmailDeliveryKey) => Promise<boolean>
  /** Undo a claim whose send then failed, so a later run can retry it. */
  releaseEmailDelivery: (key: AlertEmailDeliveryKey) => Promise<void>
  sendAlertEmail: (email: AlertEmailInput) => Promise<void>
}
```

This breaks compilation of every existing construction of the ports object until Tasks 3 and 4 land. That is expected and is why those tasks follow immediately.

- [ ] **Step 2: Write the failing store tests**

In `__tests__/lib/alerts/neon-store.test.ts`, add this helper next to the existing `notification()` helper:

```ts
function deliveryKey() {
  return {
    client_id: 'client-1',
    type: 'sov_threshold' as const,
    scan_week: '2026-08-08',
    recipient: 'owner@example.com',
  }
}
```

Then add this describe block at the end of the file:

```ts
describe('email delivery ledger', () => {
  it('claims a delivery by inserting, and reports the insert happened', async () => {
    const { sql, calls } = makeSql(() => [{ id: 'delivery-1' }])

    const claimed = await createNeonAlertStore(sql).claimEmailDelivery(deliveryKey())

    expect(claimed).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].text).toMatch(
      /ON CONFLICT\s*\(client_id,\s*type,\s*scan_week\)\s*DO NOTHING/i,
    )
    // RETURNING is what makes the claim observable: without it the driver
    // reports nothing and a re-run cannot tell a fresh insert from a no-op.
    expect(calls[0].text).toMatch(/RETURNING id/i)
    expect(calls[0].params).toEqual([
      'client-1',
      'sov_threshold',
      '2026-08-08',
      'owner@example.com',
    ])
  })

  it('reports no claim when the row already exists', async () => {
    // ON CONFLICT DO NOTHING returns zero rows, which is the whole dedupe
    // signal — this is the case that must stop a second email going out.
    const { sql } = makeSql(() => [])

    const claimed = await createNeonAlertStore(sql).claimEmailDelivery(deliveryKey())

    expect(claimed).toBe(false)
  })

  it('releases a claim by deleting exactly that week row', async () => {
    const { sql, calls } = makeSql(() => [])

    await createNeonAlertStore(sql).releaseEmailDelivery(deliveryKey())

    expect(calls).toHaveLength(1)
    expect(calls[0].text).toMatch(/DELETE FROM public\.alert_email_deliveries/i)
    expect(calls[0].params).toEqual(['client-1', 'sov_threshold', '2026-08-08'])
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run __tests__/lib/alerts/neon-store.test.ts`

Expected: FAIL — the three new tests fail with `createNeonAlertStore(...).claimEmailDelivery is not a function` (and the same for `releaseEmailDelivery`). Existing tests in the file still pass.

- [ ] **Step 4: Implement the two store methods**

In `lib/alerts/neon-store.ts`, extend the type import from `@/lib/alerts/evaluate` (lines 2-8) to include `AlertEmailDeliveryKey`:

```ts
import {
  type AlertConfigWithClient,
  type AlertEmailDeliveryKey,
  type AlertEvaluationPorts,
  type AlertNotificationInput,
  type AlertSnapshot,
  type AlertWeekSnapshot,
} from '@/lib/alerts/evaluate'
```

Replace the `NeonAlertStore` type (line 40) with:

```ts
export type NeonAlertStore = Pick<
  AlertEvaluationPorts,
  'loadSnapshot' | 'upsertNotification' | 'claimEmailDelivery' | 'releaseEmailDelivery'
>
```

Replace the `createNeonAlertStore` body (lines 42-47) with:

```ts
export function createNeonAlertStore(sql: Sql): NeonAlertStore {
  return {
    loadSnapshot: () => loadSnapshot(sql),
    upsertNotification: notification => upsertNotification(sql, notification),
    claimEmailDelivery: key => claimEmailDelivery(sql, key),
    releaseEmailDelivery: key => releaseEmailDelivery(sql, key),
  }
}
```

Append these two functions to the end of the file:

```ts
/**
 * Reserve this week's email for one client and alert type.
 *
 * RETURNING on a single-table insert is safe. The rule against `returning *`
 * applies to statements that join — the HTTP driver builds rows with
 * Object.fromEntries, so duplicate column names across joined tables silently
 * overwrite, last wins. There is no join here and the column is named.
 */
async function claimEmailDelivery(sql: Sql, key: AlertEmailDeliveryKey): Promise<boolean> {
  const rows = (await sql`
    INSERT INTO public.alert_email_deliveries (client_id, type, scan_week, recipient)
    VALUES (${key.client_id}, ${key.type}, ${key.scan_week}, ${key.recipient})
    ON CONFLICT (client_id, type, scan_week) DO NOTHING
    RETURNING id
  `) as Array<{ id: string }>

  return rows.length > 0
}

/** Hand a claim back after a failed send so a later run retries this week. */
async function releaseEmailDelivery(sql: Sql, key: AlertEmailDeliveryKey): Promise<void> {
  await sql`
    DELETE FROM public.alert_email_deliveries
    WHERE client_id = ${key.client_id}
      AND type = ${key.type}
      AND scan_week = ${key.scan_week}
  `
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run __tests__/lib/alerts/neon-store.test.ts`

Expected: PASS, all tests in the file.

- [ ] **Step 6: Commit**

```bash
git add lib/alerts/evaluate.ts lib/alerts/neon-store.ts __tests__/lib/alerts/neon-store.test.ts
git commit -m "feat(alerts): claim and release email deliveries in the Neon store"
```

---

### Task 3: Gate email sending on the claim

**Files:**
- Modify: `lib/alerts/evaluate.ts:46-49` (the `AlertAction` interface), `:125-141` (the delivery loop), `:169-199` (`buildAction`'s return)
- Test: `__tests__/lib/alerts/evaluate.test.ts`

- [ ] **Step 1: Update the existing test helper so the suite compiles**

In `__tests__/lib/alerts/evaluate.test.ts`, replace `portsFor` (lines 34-46) with:

```ts
function portsFor(data: AlertSnapshot = snapshot()) {
  const order: string[] = []
  const claimed = new Set<string>()
  const ports: AlertEvaluationPorts = {
    loadSnapshot: vi.fn().mockResolvedValue(data),
    upsertNotification: vi.fn(async notification => {
      order.push(`notification:${notification.type}`)
    }),
    // Fake the unique index: the first claim for a key wins, later ones do not.
    claimEmailDelivery: vi.fn(async key => {
      const id = `${key.client_id}:${key.type}:${key.scan_week}`
      if (claimed.has(id)) return false
      claimed.add(id)
      return true
    }),
    releaseEmailDelivery: vi.fn(async key => {
      claimed.delete(`${key.client_id}:${key.type}:${key.scan_week}`)
    }),
    sendAlertEmail: vi.fn(async email => {
      order.push(`email:${email.type}`)
    }),
  }
  return { ports, order, claimed }
}
```

- [ ] **Step 2: Write the failing tests**

Add this describe block at the end of `__tests__/lib/alerts/evaluate.test.ts`:

```ts
describe('email idempotence', () => {
  it('sends nothing on a second run over the same week', async () => {
    // The bug this closes: the notification insert dedupes through its unique
    // index, so a re-run wrote no duplicate row but still sent every email.
    const { ports } = portsFor()

    await runAlertEvaluation(ports)
    const firstRunSends = (ports.sendAlertEmail as ReturnType<typeof vi.fn>).mock.calls.length
    await runAlertEvaluation(ports)

    expect(firstRunSends).toBe(2)
    expect(ports.sendAlertEmail).toHaveBeenCalledTimes(2)
  })

  it('claims before sending, so a crash mid-send cannot double-send', async () => {
    const { ports } = portsFor()

    await runAlertEvaluation(ports)

    const claimOrder = (ports.claimEmailDelivery as ReturnType<typeof vi.fn>)
      .mock.invocationCallOrder[0]
    const sendOrder = (ports.sendAlertEmail as ReturnType<typeof vi.fn>)
      .mock.invocationCallOrder[0]
    expect(claimOrder).toBeLessThan(sendOrder)
  })

  it('releases the claim when the send fails, so the next run retries', async () => {
    const { ports } = portsFor()
    ;(ports.sendAlertEmail as ReturnType<typeof vi.fn>)
      .mockRejectedValueOnce(new Error('resend is down'))

    await runAlertEvaluation(ports)

    expect(ports.releaseEmailDelivery).toHaveBeenCalledTimes(1)
    expect(ports.releaseEmailDelivery).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'sov_threshold', scan_week: '2026-08-08' }),
    )
  })

  it('does not send when the claim itself fails', async () => {
    // A dead ledger must fail closed. Sending anyway would be the old bug with
    // extra steps: no record written, so every subsequent run re-sends.
    const { ports } = portsFor()
    ;(ports.claimEmailDelivery as ReturnType<typeof vi.fn>)
      .mockRejectedValue(new Error('ledger unavailable'))

    const result = await runAlertEvaluation(ports)

    expect(ports.sendAlertEmail).not.toHaveBeenCalled()
    // Notifications are independent of the email ledger and still land.
    expect(ports.upsertNotification).toHaveBeenCalledTimes(2)
    expect(result.fired).toBe(2)
  })

  it('keys the claim by recipient so the ledger records who was mailed', async () => {
    const { ports } = portsFor()

    await runAlertEvaluation(ports)

    expect(ports.claimEmailDelivery).toHaveBeenCalledWith(
      expect.objectContaining({
        client_id: 'client-1',
        recipient: 'owner@example.com',
        scan_week: '2026-08-08',
      }),
    )
  })
})
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run __tests__/lib/alerts/evaluate.test.ts`

Expected: FAIL. `sends nothing on a second run` fails with `expected 4 to be 2` (both runs send). `claims before sending` fails because `claimEmailDelivery` is never invoked, so `invocationCallOrder[0]` is `undefined`. `releases the claim…` fails with 0 calls. Pre-existing tests in the file still pass.

- [ ] **Step 4: Add the delivery key to the action**

In `lib/alerts/evaluate.ts`, replace the `AlertAction` interface (lines 46-49) with:

```ts
interface AlertAction {
  notification: AlertNotificationInput | null
  email: AlertEmailInput | null
  emailKey: AlertEmailDeliveryKey | null
}
```

In `buildAction`, replace the returned object (lines 173-198) with:

```ts
  const email: AlertEmailInput | null =
    config.notify_email && userEmail && dashboardUrl
      ? {
          to: userEmail,
          clientId: config.client_id,
          brandName: config.client.brand_name,
          type,
          currentSov,
          previousSov,
          threshold,
          dashboardUrl,
        }
      : null

  return {
    notification: config.notify_inapp
      ? {
          account_id: config.client.account_id,
          client_id: config.client_id,
          type,
          title,
          message,
          read: false,
          scan_week: latest.scan_week,
        }
      : null,
    email,
    emailKey: email
      ? {
          client_id: config.client_id,
          type,
          scan_week: latest.scan_week,
          recipient: email.to,
        }
      : null,
  }
```

- [ ] **Step 5: Replace the delivery loop**

In `lib/alerts/evaluate.ts`, replace the whole `for (const action of actions)` block (lines 125-141) with:

```ts
  for (const action of actions) {
    if (action.notification) {
      try {
        await ports.upsertNotification(action.notification)
      } catch (error) {
        console.error('[alerts] notification failed:', error)
      }
    }

    if (action.email && action.emailKey) {
      await deliverEmail(ports, action.email, action.emailKey)
    }
  }
```

Add this function immediately after `runAlertEvaluation` (before `buildAction`):

```ts
/**
 * Send one alert email at most once per client, type and week.
 *
 * Claim first, then send. The reverse order would re-send every alert whenever
 * a run was retried, which is what happened before the ledger existed: the
 * notification insert deduped through its unique index while the email did not.
 *
 * A failed send hands the claim back, so the loss is a delayed email rather
 * than a permanently swallowed one. A failed claim sends nothing at all -- a
 * dead ledger cannot record what went out, so proceeding would reintroduce the
 * same duplicate-send bug with no record to stop it.
 */
async function deliverEmail(
  ports: AlertEvaluationPorts,
  email: AlertEmailInput,
  key: AlertEmailDeliveryKey,
): Promise<void> {
  let claimed = false
  try {
    claimed = await ports.claimEmailDelivery(key)
  } catch (error) {
    console.error('[alerts] email claim failed:', error)
    return
  }

  if (!claimed) return

  try {
    await ports.sendAlertEmail(email)
  } catch (error) {
    console.error('[alerts] email failed:', error)
    try {
      await ports.releaseEmailDelivery(key)
    } catch (releaseError) {
      console.error('[alerts] email claim release failed:', releaseError)
    }
  }
}
```

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run __tests__/lib/alerts/evaluate.test.ts`

Expected: PASS, every test in the file including the five new ones.

- [ ] **Step 7: Commit**

```bash
git add lib/alerts/evaluate.ts __tests__/lib/alerts/evaluate.test.ts
git commit -m "fix(alerts): send each alert email at most once per week"
```

---

### Task 4: GET handler for Vercel Cron

**Files:**
- Modify: `app/api/cron/evaluate-alerts/route.ts`
- Test: `__tests__/api/cron/evaluate-alerts.test.ts`

- [ ] **Step 1: Write the failing tests**

In `__tests__/api/cron/evaluate-alerts.test.ts`, add this helper next to the existing `request` helper (lines 20-24):

```ts
function cronRequest(bearer?: string) {
  return new Request('https://app.example/api/cron/evaluate-alerts', {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  })
}
```

Then add this describe block at the end of the file. Note it repeats the `beforeEach` / `afterEach` setup rather than sharing it — the existing describe owns its own, and Vitest hooks do not leak across sibling describes:

```ts
describe('GET /api/cron/evaluate-alerts', () => {
  const originalCronSecret = process.env.CRON_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'
    h.db.mockReturnValue('sql')
    h.createNeonAlertStore.mockReturnValue({
      loadSnapshot: vi.fn(),
      upsertNotification: vi.fn(),
      claimEmailDelivery: vi.fn(),
      releaseEmailDelivery: vi.fn(),
    })
    h.runAlertEvaluation.mockResolvedValue({ processed: 3, fired: 2 })
  })

  afterEach(() => {
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = originalCronSecret
  })

  it('accepts the Bearer header Vercel Cron actually sends', async () => {
    // The reason this handler exists: Vercel Cron issues GET with
    // `Authorization: Bearer $CRON_SECRET`. The POST handler reads only
    // x-cron-secret, so a cron pointed at it would 405 forever, silently.
    const { GET } = await importRoute()

    const response = await GET(cronRequest('test-cron-secret'))

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ processed: 3, fired: 2 })
    expect(h.runAlertEvaluation).toHaveBeenCalledOnce()
  })

  it('rejects a missing or wrong Bearer token', async () => {
    const { GET } = await importRoute()

    const wrong = await GET(cronRequest('wrong-secret'))
    const missing = await GET(cronRequest())

    expect(wrong.status).toBe(401)
    expect(missing.status).toBe(401)
    expect(h.db).not.toHaveBeenCalled()
    expect(h.runAlertEvaluation).not.toHaveBeenCalled()
  })

  it('does not accept the POST handler\'s header shape', async () => {
    // Guards against "fixing" this by making GET read either header. Vercel
    // sends Bearer; anything else reaching GET is not the scheduler.
    const { GET } = await importRoute()

    const response = await GET(request('test-cron-secret'))

    expect(response.status).toBe(401)
  })

  it('returns 500 rather than running when CRON_SECRET is unset or too short', async () => {
    // A short secret is a misconfiguration, not a credential. cron/pulse
    // applies the same floor and CLAUDE.md documents it as >= 16 chars.
    const { GET } = await importRoute()
    delete process.env.CRON_SECRET
    const unset = await GET(cronRequest('test-cron-secret'))

    process.env.CRON_SECRET = 'too-short'
    const short = await GET(cronRequest('too-short'))

    expect(unset.status).toBe(500)
    expect(short.status).toBe(500)
    expect(h.runAlertEvaluation).not.toHaveBeenCalled()
  })

  it('composes the same ports the POST handler does', async () => {
    const store = {
      loadSnapshot: vi.fn(),
      upsertNotification: vi.fn(),
      claimEmailDelivery: vi.fn(),
      releaseEmailDelivery: vi.fn(),
    }
    h.createNeonAlertStore.mockReturnValue(store)
    const { GET } = await importRoute()

    await GET(cronRequest('test-cron-secret'))

    expect(h.createNeonAlertStore).toHaveBeenCalledWith('sql')
    expect(h.runAlertEvaluation).toHaveBeenCalledWith({
      ...store,
      sendAlertEmail: h.sendAlertEmail,
    })
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/api/cron/evaluate-alerts.test.ts`

Expected: FAIL — every new test fails with `GET is not a function` (the route exports only `POST`). The existing POST describe still passes.

- [ ] **Step 3: Rewrite the route**

Replace the whole of `app/api/cron/evaluate-alerts/route.ts` with:

```ts
import {
  runAlertEvaluation,
  type AlertEvaluationPorts,
} from '@/lib/alerts/evaluate'
import { createNeonAlertStore } from '@/lib/alerts/neon-store'
import { db } from '@/lib/db'
import { sendAlertEmail as deliverAlertEmail } from '@/lib/resend'

export const dynamic = 'force-dynamic'

/**
 * Two entry points, deliberately.
 *
 *   GET  + `Authorization: Bearer $CRON_SECRET`  <- Vercel Cron, the scheduler
 *   POST + `x-cron-secret`                       <- operators, the smoke checks
 *                                                   in docs/alert-evaluation-release.md
 *
 * Neither shape is ours to choose, and a cron pointed at a POST-only route
 * would 405 forever without ever saying so.
 *
 * Unlike cron/pulse there is no driver hop to a second route. That hop exists
 * because pulse/run is chunked and re-entrant -- one invocation cannot finish a
 * week inside the 60s ceiling, so the driver chains via after(). Alert
 * evaluation is one bounded pass over alert_configs, so an internal fetch would
 * only add failure modes: origin resolution, an extra invocation, another
 * error path to interpret.
 */
function evaluateAlerts() {
  const ports: AlertEvaluationPorts = {
    ...createNeonAlertStore(db()),
    sendAlertEmail: deliverAlertEmail,
  }
  return runAlertEvaluation(ports)
}

/**
 * Read the secret, or null when it is missing or too short to be one.
 *
 * Compared against a known-present value at both call sites, so an unset var
 * can never make an absent header match -- the pre-fence trial-emails route
 * compared against `Bearer undefined` and would have accepted that literal.
 */
function cronSecret(): string | null {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < 16) return null
  return secret
}

export async function GET(req: Request) {
  const secret = cronSecret()
  if (!secret) {
    console.error('[cron/evaluate-alerts] CRON_SECRET is unset or shorter than 16 characters')
    return Response.json({ error: 'Server misconfiguration' }, { status: 500 })
  }

  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return Response.json(await evaluateAlerts())
}

export async function POST(req: Request) {
  const secret = cronSecret()
  if (!secret) {
    console.error('[cron/evaluate-alerts] CRON_SECRET is unset or shorter than 16 characters')
    return Response.json({ error: 'Cron not configured' }, { status: 500 })
  }

  const incomingSecret = req.headers.get('x-cron-secret')
  if (!incomingSecret || incomingSecret !== secret) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  return Response.json(await evaluateAlerts())
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/api/cron/evaluate-alerts.test.ts`

Expected: PASS, both describes.

- [ ] **Step 5: Typecheck, since the ports interface changed under two call sites**

Run: `npm run typecheck`

Expected: exits 0 with no output. This is the step that proves Tasks 2-4 left no construction of `AlertEvaluationPorts` missing the new ports.

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/evaluate-alerts/route.ts __tests__/api/cron/evaluate-alerts.test.ts
git commit -m "feat(alerts): accept the Vercel Cron GET shape on evaluate-alerts"
```

---

### Task 5: Schedule the cron

**Files:**
- Modify: `vercel.json`
- Test: `__tests__/config/function-durations.test.ts`

`__tests__/config/function-durations.test.ts` pins the `crons` array exactly, so it fails the moment `vercel.json` changes. That is the release gate working as designed — update it in the same commit, never by loosening the assertion.

- [ ] **Step 1: Write the failing test**

In `__tests__/config/function-durations.test.ts`, replace the `expect(config.crons).toEqual([...])` assertion inside `'schedules the Pulse driver, and every cron path is a route that exists'` (lines 49-51) with:

```ts
    expect(config.crons).toEqual([
      { path: '/api/cron/pulse', schedule: '17 4 * * 1' },
      { path: '/api/cron/evaluate-alerts', schedule: '47 7 * * 1' },
    ])
```

Then add this test at the end of the same describe block:

```ts
  it('evaluates alerts after the rollup they read, on the same day', () => {
    // Alerts compare the latest two aggregate weeks. Run before the week's
    // rollup lands and the comparison is last week against the week before --
    // it would not error, it would just be quietly a week stale, every week.
    const at = (schedule: string) => {
      const [minute, hour, , , weekday] = schedule.split(' ')
      return { weekday, minutes: Number(hour) * 60 + Number(minute) }
    }

    const pulse = config.crons?.find(cron => cron.path === '/api/cron/pulse')
    const alerts = config.crons?.find(cron => cron.path === '/api/cron/evaluate-alerts')
    expect(pulse, 'the Pulse driver is not scheduled').toBeDefined()
    expect(alerts, 'alert evaluation is not scheduled').toBeDefined()

    expect(at(alerts!.schedule).weekday).toBe(at(pulse!.schedule).weekday)
    expect(at(alerts!.schedule).minutes).toBeGreaterThan(at(pulse!.schedule).minutes)
  })
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/config/function-durations.test.ts`

Expected: FAIL. The pinned-array test fails because `vercel.json` still has one cron; the new ordering test fails on `the Pulse driver is not scheduled` being fine but `alerts` being `undefined`.

- [ ] **Step 3: Schedule it**

In `vercel.json`, add the `maxDuration` entry to `functions` and the cron entry to `crons`. The file becomes:

```json
{
  "functions": {
    "app/api/scan/route.ts": { "maxDuration": 60 },
    "app/api/fix/route.ts": { "maxDuration": 30 },
    "app/api/pulse/run/route.ts": { "maxDuration": 60 },
    "app/api/cron/pulse/route.ts": { "maxDuration": 60 },
    "app/api/cron/evaluate-alerts/route.ts": { "maxDuration": 60 }
  },
  "crons": [
    { "path": "/api/cron/pulse", "schedule": "17 4 * * 1" },
    { "path": "/api/cron/evaluate-alerts", "schedule": "47 7 * * 1" }
  ]
}
```

Two things to know about those values. The `maxDuration` is there because evaluation walks every alert config and awaits a Resend call per fired alert; the platform default of 10s is well under that, and 60s is the Hobby ceiling the whole file stays inside. The schedule is Monday 07:47 UTC — 15:47 Hong Kong — which is three and a half hours after the Pulse driver starts at 04:17 UTC, leaving the chained producer time to land the week's rollup first.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/config/function-durations.test.ts`

Expected: PASS, including the Hobby-ceiling test (60 ≤ 60), the two-cron cap (exactly 2), the no-wildcard minute/hour test, and the `GET` export check now satisfied by Task 4.

- [ ] **Step 5: Commit**

```bash
git add vercel.json __tests__/config/function-durations.test.ts
git commit -m "feat(alerts): schedule evaluate-alerts weekly after the Pulse rollup"
```

---

### Task 6: Flip the release state

**Files:**
- Modify: `lib/plans/catalog.ts` (pro `release` block, enterprise `release` block, and the stale comment above them)
- Test: `__tests__/lib/plans/alerts-release.test.ts`

Never edit pricing copy directly — `app/[lang]/pricing/page.tsx` derives the alerts row from `release.sovAlerts` at lines 145-146. Changing the catalog changes the page.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/plans/alerts-release.test.ts`:

```ts
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import { PLAN_CATALOG } from '@/lib/plans/catalog'

type VercelConfig = { crons?: Array<{ path: string }> }

describe('sovAlerts release state', () => {
  it('is available exactly on the plans entitled to alerts', () => {
    expect(PLAN_CATALOG.pro.release.sovAlerts).toBe('available')
    expect(PLAN_CATALOG.enterprise.release.sovAlerts).toBe('available')
    expect(PLAN_CATALOG.free.release.sovAlerts).toBe('unavailable')
    expect(PLAN_CATALOG.basic.release.sovAlerts).toBe('unavailable')
  })

  it('matches the entitlement flag, so the page cannot advertise what the gate refuses', () => {
    for (const plan of ['free', 'basic', 'pro', 'enterprise'] as const) {
      expect(
        PLAN_CATALOG[plan].release.sovAlerts === 'available',
        `${plan}: release state and features.alerts disagree`,
      ).toBe(PLAN_CATALOG[plan].features.alerts)
    }
  })

  it('is only claimed while something actually fires the evaluator', () => {
    // The whole reason this was 'planned': the evaluator existed but nothing
    // invoked it, so the page would have promised a feature that never ran.
    // Removing the cron must make this fail rather than quietly go back to
    // shipping the claim without the capability.
    const config = JSON.parse(
      readFileSync(join(process.cwd(), 'vercel.json'), 'utf8'),
    ) as VercelConfig
    const scheduled = config.crons?.some(
      cron => cron.path === '/api/cron/evaluate-alerts',
    )

    expect(
      scheduled,
      'sovAlerts is advertised as available but evaluate-alerts is not scheduled',
    ).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/lib/plans/alerts-release.test.ts`

Expected: FAIL on the first two tests — `expected 'planned' to be 'available'`. The third passes already, because Task 5 scheduled the cron.

- [ ] **Step 3: Flip the catalog**

In `lib/plans/catalog.ts`, in the `pro.release` block, replace the comment and the `promptBank` / `sovAlerts` line (the comment currently reads "sovAlerts is still entitled but unshipped — the evaluator has no scheduler and no source for the rows it reads") with:

```ts
      // promptBank shipped: the four routes are live and the editor is reachable
      // at /{lang}/dashboard/{clientId}/prompts. sovAlerts shipped once
      // evaluate-alerts got a GET handler and a weekly cron in vercel.json —
      // __tests__/lib/plans/alerts-release.test.ts fails if that cron is ever
      // removed while this still says available.
      promptBank: 'available', sovAlerts: 'available',
```

In the `enterprise.release` block, replace:

```ts
      promptBank: 'available', sovAlerts: 'planned',
```

with:

```ts
      promptBank: 'available', sovAlerts: 'available',
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/lib/plans/alerts-release.test.ts`

Expected: PASS, 3 tests.

- [ ] **Step 5: Check nothing else pinned the old state**

Run: `npx vitest run __tests__/lib/plans/ __tests__/components/pricing-page.test.ts`

Expected: PASS. If the second path does not exist, Vitest reports no files for it and the first still runs — that is fine. If any pricing test asserted `coming_soon` for the alerts row, update it to expect the row to be enabled, and say so in the commit body.

- [ ] **Step 6: Commit**

```bash
git add lib/plans/catalog.ts __tests__/lib/plans/alerts-release.test.ts
git commit -m "feat(alerts): mark sovAlerts available now that evaluation is scheduled"
```

---

### Task 7: Documentation and the full suite

**Files:**
- Modify: `docs/alert-evaluation-release.md`, `CLAUDE.md`, `README.md`

- [ ] **Step 1: Update the release gate doc**

In `docs/alert-evaluation-release.md`, replace lines 3-6 (the opening paragraph naming only 033 and 034) with:

```markdown
Migrations `supabase/migrations/033_alert_evaluation_hardening.sql`,
`supabase/migrations/034_alert_evaluation_snapshot_refinement.sql` and
`supabase/migrations/035_alert_email_delivery_ledger.sql` must be applied, in order,
to the target Neon database before deploying `app/api/cron/evaluate-alerts`.
```

Then add a step 3 to the numbered smoke checks, renumbering the rest, and append two new checks at the end of the list:

```markdown
3. Apply migration 035 through the normal approved Neon migration process after 034.
```

```markdown
6. Verify a second invocation in the same week sends no further email: run the route
   twice with `POST` + `x-cron-secret` against a seeded breach and confirm
   `alert_email_deliveries` holds exactly one row for that
   `(client_id, type, scan_week)` and the mailbox received exactly one message.
7. Verify the schedule: `vercel.json` runs `/api/cron/evaluate-alerts` at `47 7 * * 1`,
   after the Pulse driver's `17 4 * * 1`. Vercel Cron calls it with `GET` and
   `Authorization: Bearer $CRON_SECRET`; confirm one 200 in the deployment logs on the
   first Monday after release.
```

- [ ] **Step 2: Update CLAUDE.md**

Three edits. In the deployment-config bullet, replace the cron sentence so it reads:

```markdown
  `maxDuration` (60s scan, 30s fix, 60s each for `pulse/run`, `cron/pulse` and
  `cron/evaluate-alerts`) **and two weekly crons** — `17 4 * * 1` → `/api/cron/pulse`
  and `47 7 * * 1` → `/api/cron/evaluate-alerts`, in that order because alerts read the
  rollup Pulse writes.
```

In the `CRON_SECRET` bullet, replace the sentence describing `cron/evaluate-alerts` as unscheduled with:

```markdown
  `cron/evaluate-alerts` is scheduled weekly and accepts **both** shapes: `GET` with
  `Authorization: Bearer` for Vercel Cron, `POST` with `x-cron-secret` for the smoke
  checks in `docs/alert-evaluation-release.md`. It needs no driver hop — unlike
  `pulse/run` it is one bounded pass, not a chunked producer.
```

In the migrations section, update both the file count and the pending list to include `035`: the directory now holds 33 files spanning `001`–`035`, and pending becomes `027`, `029`–`035`.

- [ ] **Step 3: Update README.md**

In the fenced-features paragraph, replace the sentence beginning "The alert *evaluator* is neither" with:

```markdown
Alert evaluation is live: the evaluator runs weekly through Vercel Cron and emails
threshold, week-over-week and recovery alerts, deduped to one per client, type and week.
Its in-app notifications are written but not yet readable — the `notifications` routes
are still fenced.
```

- [ ] **Step 4: Run the whole suite**

Run: `npm run test:unit`

Expected: PASS, every file. The count should be 136 files (two added by this plan) and roughly 1500 tests. A failure here that the per-task runs did not catch is almost certainly a test elsewhere that pinned `sovAlerts: 'planned'` or constructed `AlertEvaluationPorts` — fix it, do not weaken it.

- [ ] **Step 5: Lint and typecheck**

Run: `npm run lint`

Expected: exits 0, no output. This repo keeps lint at zero errors and zero warnings.

Run: `npm run typecheck`

Expected: exits 0, no output.

- [ ] **Step 6: Commit**

```bash
git add docs/alert-evaluation-release.md CLAUDE.md README.md
git commit -m "docs: record that alert evaluation is scheduled"
```

---

### Task 8: Production release (ops — requires production access)

**Do not perform these steps as part of implementing the plan.** They belong to whoever holds the production Neon and Vercel credentials, and they happen after the PR merges. Listed here so the PR description can point at them.

- [ ] **Step 1: Establish the true migration state**

```bash
npm run migrate -- --verify
```

Read the report before doing anything else. `CLAUDE.md`'s believed-applied list has been wrong before and is not evidence. This also settles the disputed `021`: if `local_trust_profiles` exists, `021` ran.

- [ ] **Step 2: Apply the outstanding migrations in order**

```bash
npm run migrate -- --dry-run
```

Confirm the preview lists the migrations you expect and nothing else, then:

```bash
npm run migrate
```

`033`, `034` and `035` must all be applied before the route is reachable. Never pass `--baseline` here: baselining records a migration as applied without running it, which for `035` would permanently strand the ledger table and make every email send throw.

- [ ] **Step 3: Run the smoke checks**

Follow `docs/alert-evaluation-release.md` steps 1-7 as updated in Task 7, including the new double-invocation check that proves one email per week.

- [ ] **Step 4: Watch the first scheduled firing**

The first run is the Monday after deployment at 07:47 UTC (15:47 HKT). Confirm one 200 in the Vercel logs, and that `alert_email_deliveries` gained rows only for clients whose SoV actually crossed a threshold.

Note the dependency the schedule cannot enforce: week-over-week alerts need two consecutive `pulse_weekly_summary` aggregate rows. Threshold and recovery alerts fire from one week, but `sov_wow_drop` stays silent until a second rollup lands, and that is correct behaviour rather than a fault.

---

## What this plan deliberately does not do

- **It does not restore the notifications read surface.** Rows are written and deduped, but `GET /api/notifications`, `notifications/read-all` and `NotificationBell` stay fenced and orphaned. That is roadmap item N4 and needs its own auth → entitlement → ownership gate copied from `lib/localTrust/guard.ts`. Until it lands, alerts are email-only from the user's point of view — worth saying in the PR description.
- **It does not touch `release.monitoring`.** That flip depends on two confirmed production Pulse rollups, which is a separate item.
- **It does not add retry or backoff around Resend.** A failed send releases its claim and the next weekly run retries. Anything finer needs a queue, and there is no evidence yet that one is warranted.
