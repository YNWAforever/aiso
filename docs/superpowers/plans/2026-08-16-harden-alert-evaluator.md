# Harden the Live Alert Evaluator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the alert evaluator from silently dropping a client's genuine weekly alert, and make a truncated run impossible to mistake for a complete one.

**Architecture:** Two independent defects, both recorded in `docs/alert-evaluation-release.md` as "accept or mitigate before enabling production traffic". Neither is hypothetical any more — `vercel.json` schedules `/api/cron/evaluate-alerts` at `47 7 * * 1` and that shipped to `main` in `1aa05a2`. Tasks 1–4 close the staleness hole, which loses alerts at a single client. Tasks 5–6 bound the delivery loop, which loses them at scale. Task 7 proves the lot against a real database.

**Tech Stack:** TypeScript 5.9, Next.js 16 route handlers, Neon Postgres (`@neondatabase/serverless`, HTTP driver), Vitest 4 (unit + integration projects), Vercel Cron.

---

## Read this first

### The staleness defect, precisely

`runAlertEvaluation` (`lib/alerts/evaluate.ts:87`) takes `weeks[0]` as "this week" **whatever week it actually is**:

```ts
const latest = weeks[0]
const previous = weeks[1]
```

`loadWeeklyRows` (`lib/alerts/neon-store.ts:154`) orders by `scan_week DESC` and takes the top two. It never asks whether the top row is the *current* week.

So when a client's Pulse rollup has not landed — the rollup cron failed, the producer errored, the week is simply not written yet — `weeks[0]` is **last week's** row. The evaluator then re-derives last week's action, whose ledger row `claimEmailDelivery` already inserted during last week's run. The claim returns `false`, `deliverEmail` returns `'suppressed'`, and the run reports:

```json
{ "processed": 1, "fired": 1, "emailed": 0, "emailFailures": 0, "notificationFailures": 0 }
```

That is **byte-identical to a healthy idempotent re-run**. The client's genuine current-week alert is never computed, nothing errors, and the cron is green. This is the same silent-green failure class as the Pulse driver's `processed: 0`, and it is worth fixing the same way: make the do-nothing case say so.

The ordering that produces it rests on nothing but two cron times three and a half hours apart (`17 4 * * 1` then `47 7 * * 1`). No mechanism enforces that the rollup landed first.

### Where "the current week" must come from

**Postgres, not JavaScript.** The codebase has no TS-side week helper. Every existing writer and reader derives the week in SQL:

- `lib/pulse/schedule.ts:56` — `and m.scan_week = date_trunc('week', now())::date`
- `lib/pulse/schedule.ts:68` — `and s.scan_week = date_trunc('week', now())::date`
- `lib/pulse/summary.ts:15` — `WEEK_START_SQL = "date_trunc('week', $1::date)::date"`

Computing it from `new Date()` in the app would introduce a second, disagreeing definition of "this week" whose answer depends on the server's timezone. That is exactly the bug fixed in `d243eb5` earlier today. Do not do it. Get the value from the same database that stores the rows being compared.

### A latent instance of that same bug, already in this file

`lib/alerts/neon-store.ts:77-79`:

```ts
scan_week: row.scan_week instanceof Date
  ? row.scan_week.toISOString().slice(0, 10)
  : row.scan_week,
```

A Postgres `date` has no time or zone, and a driver that parses it builds the `Date` at **local** midnight. `toISOString()` then converts to UTC, so at any positive UTC offset it reports **the previous day**. In Hong Kong (UTC+8) `2026-08-10` becomes `2026-08-09`.

This is currently latent, not active: `db()` is the HTTP driver, which returns `date` as a string, so the `instanceof Date` branch does not fire in production. It fires under the WebSocket/`Client` driver. Leaving it is not safe — the value feeds `scan_week` into both the notification dedup key and the email ledger key, so if it ever activates, every key is off by one day and dedup silently stops working. Task 1 removes it.

### The truncation defect, and its honest scope

`runAlertEvaluation` awaits one notification insert, one ledger claim and one Resend send **per fired alert, in series** (`lib/alerts/evaluate.ts:157-174`). At typical round-trip latencies that truncates somewhere around 100–150 fired alerts against the 60s `maxDuration`. Because `loadConfigs` orders by `ac.id ASC`, it is the same suffix of customers every week, and Vercel Cron does not retry.

**There are currently zero `alert_configs` rows**, so this is not biting today. Tasks 5–6 are therefore deliberately *not* a rearchitecture: no chunk-and-chain driver, no lease/TTL. They do two cheap things — raise the ceiling with bounded concurrency, and make a truncated run loud instead of silent. If the ceiling is ever actually reached, the chunk-and-chain shape `cron/pulse` uses is the next step, and that is a different plan.

### What will break when you touch the return type

`runAlertEvaluation`'s return shape is asserted **exactly** (`toEqual`, not `toMatchObject`) in **6** places in `__tests__/lib/alerts/evaluate.test.ts` (14 tests total), and the shape is also asserted in `__tests__/api/cron/evaluate-alerts.test.ts`. Adding a key to the return breaks every one of them. This is expected and the tasks below handle it explicitly — do not "fix" it by loosening `toEqual` to `toMatchObject`, which would stop those tests noticing an unintended extra field.

### Ground rules

- **Start a new branch.** `claude/fimmick-aeo-status-roadmap-bd4837` was merged into `main` and pushed as `1aa05a2`; continuing on it would put new work on a branch whose name and history describe finished work. Branch from `main`.
- **Do not connect to production.** Task 7 uses the harness's throwaway branch, which provisions and deletes itself. Never set `TEST_DATABASE_URL` or `DATABASE_URL` by hand.
- **Do not run any `git stash` command.** There is an unrelated pre-existing stash in this repository.
- `npm test` does not work in a worktree with an empty `node_modules` — run `npm run test:unit` and `REQUIRE_INTEGRATION_TESTS=1 npm run test:integration` instead.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `lib/iso-date.ts` | One definition of "render a driver date column as `YYYY-MM-DD`". Currently duplicated as a private helper in `lib/pulse/summary.ts` and mis-implemented in `lib/alerts/neon-store.ts`. | Create |
| `__tests__/lib/iso-date.test.ts` | Pins the local-vs-UTC behaviour that makes the two call sites correct, and a precondition test that fails loudly if the file's TZ pin goes inert | Create |
| `lib/pulse/summary.ts` | Drop its private copy, import the shared one | Modify |
| `lib/alerts/neon-store.ts` | Use the shared one; load and return `currentScanWeek` | Modify |
| `lib/alerts/evaluate.ts` | Carry `currentScanWeek` on the snapshot; skip stale clients; bound the delivery loop | Modify |
| `app/api/cron/evaluate-alerts/route.ts` | Surface `stale` and `deferred` in the status decision | Modify |
| `__tests__/lib/alerts/evaluate.test.ts` | Cover staleness and truncation; absorb the return-shape change | Modify |
| `__tests__/lib/pulse-summary.test.ts` | Task 1: regression test for `computeWeeklySummary` rendering a driver-supplied `Date` through the shared `isoDate()` | Modify |
| `__tests__/lib/alerts/neon-store.test.ts` | Task 1: Date-fixture regression proving `loadSnapshot` uses the shared `isoDate()`, plus its own TZ-pin precondition test. Task 2 (pending): cover `currentScanWeek` loading | Modify |
| `vitest.config.ts` | Task 1: pin `pool: 'forks'` so the TZ-pin preconditions above cannot go silently inert under `threads` | Modify |
| `__tests__/api/cron/evaluate-alerts.test.ts` | Cover the new status rules | Modify |
| `__tests__/integration/alert-staleness.test.ts` | Prove the guard against real SQL | Create |
| `docs/alert-evaluation-release.md` | Replace two "known limitation" bullets with what now happens | Modify |

**Commands:**

```bash
npx vitest run __tests__/path/to/file.test.ts
```

```bash
npm run test:unit
```

```bash
REQUIRE_INTEGRATION_TESTS=1 npm run test:integration
```

```bash
npm run lint && npm run typecheck
```

Baseline before this plan: **141 files / 1551 unit tests** and **7 files / 36 integration tests** pass; lint and typecheck are clean.

---

### Task 1: One correct ISO-date normaliser, used by both call sites

**Files:**
- Create: `lib/iso-date.ts`
- Create: `__tests__/lib/iso-date.test.ts`
- Modify: `lib/pulse/summary.ts:23-44` (remove the private `isoDate`, import the shared one)
- Modify: `lib/alerts/neon-store.ts:77-79` (replace the `toISOString().slice(0, 10)` call)
- Modify: `__tests__/lib/pulse-summary.test.ts` (correct a comment that overclaimed what its equality assertion pins)
- Modify: `__tests__/lib/alerts/neon-store.test.ts` (Date-fixture regression for the `loadSnapshot` call site, plus a TZ-pin precondition test)
- Modify: `vitest.config.ts` (pin `pool: 'forks'` so the TZ-pin preconditions cannot go silently inert)

- [x] **Step 1: Write the failing test**

Create `__tests__/lib/iso-date.test.ts`:

```ts
import { describe, expect, it } from 'vitest'

import { isoDate } from '@/lib/iso-date'

// Pin a positive-offset zone: at TZ=UTC a toISOString() implementation and a
// local-components one agree exactly, so the regression these tests exist for
// is undetectable there. CI runners default to UTC, which is precisely where
// this guard needs to work.
process.env.TZ = 'Asia/Hong_Kong'

describe('isoDate', () => {
  it('runs under the pinned timezone the date assertions depend on', () => {
    // If this fails, process.env.TZ above did not take effect -- Node worker
    // threads ignore a runtime mutation, so under Vitest's `threads` pool the
    // pin is a no-op and every assertion below silently degrades to the
    // UTC-blind version this file was written to replace. -480 is UTC+8.
    expect(new Date(2026, 7, 10).getTimezoneOffset()).toBe(-480)
  })

  it('passes a string date through unchanged', () => {
    // The HTTP driver returns `date` columns as 'YYYY-MM-DD' strings already.
    expect(isoDate('2026-08-10', 'fallback')).toBe('2026-08-10')
  })

  it('renders a Date as its LOCAL calendar day, not its UTC one', () => {
    // The bug this exists to prevent: a Postgres `date` has no time or zone, so
    // a parsing driver builds the Date at local midnight. toISOString() then
    // shifts to UTC and reports the previous day at any positive offset --
    // 2026-08-10 becomes 2026-08-09 in Hong Kong. Reading local components is
    // what makes the round-trip lossless in every timezone. The module-level
    // TZ pin above is why this reliably catches that shift instead of only
    // catching it on a developer machine that happens to sit east of UTC.
    const localMidnight = new Date(2026, 7, 10)

    expect(isoDate(localMidnight, 'fallback')).toBe('2026-08-10')
  })

  it('pads single-digit months and days', () => {
    expect(isoDate(new Date(2026, 0, 5), 'fallback')).toBe('2026-01-05')
  })

  it('falls back when the value is absent or not a date', () => {
    expect(isoDate(undefined, '2026-01-01')).toBe('2026-01-01')
    expect(isoDate(null, '2026-01-01')).toBe('2026-01-01')
    expect(isoDate('', '2026-01-01')).toBe('2026-01-01')
  })

  it('falls back on an invalid Date rather than rendering NaN-NaN-NaN', () => {
    // An unparseable Date still passes `instanceof Date` -- only getTime()
    // reveals it's invalid. Without the guard this renders 'NaN-NaN-NaN', a
    // string that typechecks as a date but is garbage as a dedup key.
    expect(isoDate(new Date('garbage'), '2026-01-01')).toBe('2026-01-01')
  })
})
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/iso-date.test.ts`

Expected: FAIL — `Failed to resolve import "@/lib/iso-date"`.

- [x] **Step 3: Write the implementation**

Create `lib/iso-date.ts`:

```ts
/**
 * Render whatever a driver returned for a `date` column as `YYYY-MM-DD`.
 *
 * The two drivers in play disagree. The HTTP driver (`db()`) hands a `date`
 * back as a string; the WebSocket/`Client` driver parses it into a `Date`.
 * Code that assumes one of those shapes breaks silently under the other, which
 * is how `computeWeeklySummary` came to return
 * "Mon Jan 05 2026 00:00:00 GMT+0800 (Hong Kong Standard Time)" from an API
 * field typed as a date (fixed in d243eb5).
 *
 * Read the LOCAL components, never `toISOString()`. A Postgres `date` carries
 * no time or zone and the driver builds the Date at local midnight, so at any
 * positive UTC offset `toISOString()` reports the previous day. Where the value
 * is a dedup key -- `notifications (client_id, type, scan_week)` and
 * `alert_email_deliveries (client_id, type, scan_week)` -- being one day off
 * does not throw. It silently stops deduplicating.
 */
export function isoDate(value: string | Date | null | undefined, fallback: string): string {
  if (value instanceof Date) {
    // An invalid Date (e.g. new Date('garbage')) must fall back rather than
    // render 'NaN-NaN-NaN' -- a string that typechecks as a date but is
    // garbage as a dedup key.
    if (Number.isNaN(value.getTime())) return fallback
    const month = String(value.getMonth() + 1).padStart(2, '0')
    const day = String(value.getDate()).padStart(2, '0')
    return `${value.getFullYear()}-${month}-${day}`
  }
  return typeof value === 'string' && value !== '' ? value : fallback
}
```

- [x] **Step 4: Run it to verify it passes**

Run: `npx vitest run __tests__/lib/iso-date.test.ts`

Expected: PASS, 6 tests.

- [x] **Step 5: Route `lib/pulse/summary.ts` through the shared helper**

In `lib/pulse/summary.ts`, **delete** the private `isoDate` function and its doc comment (added in `d243eb5`, currently lines 23–44), and add the import at the top of the file:

```ts
import { isoDate } from '@/lib/iso-date'
```

Leave the call site at the bottom of `computeWeeklySummary` exactly as it is:

```ts
    scanWeek: isoDate(written[0]?.scan_week, scanWeek),
```

- [x] **Step 6: Fix the week-shift in the alert store**

In `lib/alerts/neon-store.ts`, add to the imports:

```ts
import { isoDate } from '@/lib/iso-date'
```

Then replace the `scan_week` normalisation inside `loadSnapshot` (currently lines 77–79):

```ts
      scan_week: row.scan_week instanceof Date
        ? row.scan_week.toISOString().slice(0, 10)
        : row.scan_week,
```

with:

```ts
      // This value is the scan_week half of both dedup keys. The '' fallback
      // is unreachable in practice -- pulse_weekly_summary.scan_week is
      // `date not null` -- and deliberate: a missing value should degrade to
      // a counted failure downstream, not a wrong-but-plausible date string.
      scan_week: isoDate(row.scan_week, ''),
```

- [x] **Step 7: Run the affected suites**

Run: `npx vitest run __tests__/lib/iso-date.test.ts __tests__/lib/pulse-summary.test.ts __tests__/lib/alerts/`

Expected: PASS, all files. `__tests__/lib/pulse-summary.test.ts` includes a test named `'renders a driver-supplied Date as an ISO date, not a locale sentence'` which must still pass — it is the regression test for `d243eb5` and pins that `computeWeeklySummary` renders a driver-supplied `Date` as the expected `YYYY-MM-DD` string via the shared `isoDate()`. It does **not** by itself distinguish local components from `toISOString()`: at TZ=UTC (CI's ambient default, since nothing pins TZ for that file) the two implementations agree exactly. That distinction is what `__tests__/lib/iso-date.test.ts` guards, and that file pins TZ itself so the two implementations are made to diverge. `__tests__/lib/alerts/neon-store.test.ts` carries the equivalent regression and pin for the `loadSnapshot` call site.

- [x] **Step 8: Commit**

```bash
git add lib/iso-date.ts __tests__/lib/iso-date.test.ts lib/pulse/summary.ts lib/alerts/neon-store.ts
git commit -m "refactor(dates): share one ISO-date normaliser and fix the alert store's UTC shift"
```

---

### Task 2: The snapshot carries the database's idea of the current week

**Files:**
- Modify: `lib/alerts/evaluate.ts:20-25` (the `AlertSnapshot` interface)
- Modify: `lib/alerts/neon-store.ts:55-98` (`loadSnapshot`)
- Test: `__tests__/lib/alerts/neon-store.test.ts`

- [x] **Step 1: Write the failing test**

Add this to `__tests__/lib/alerts/neon-store.test.ts`, inside the existing top-level `describe`.

That file already has the mocking helper you need — `makeSql(respond)` at the top, where `respond` receives `{ text, params }` and returns the rows. It returns `{ sql, calls }`, and `sql` is already typed `NeonQueryFunction<false, false>`, so `createNeonAlertStore(sql)` takes it with no cast. Use it; do not hand-roll a second tagged-template fake.

```ts
  it('reads the current scan week from Postgres rather than the app clock', async () => {
    // Every other writer and reader derives the week in SQL
    // (lib/pulse/schedule.ts:56, :68; lib/pulse/summary.ts WEEK_START_SQL).
    // Deriving it from new Date() here would create a second definition of
    // "this week" that disagrees whenever the app server's timezone differs
    // from the database's -- and this value decides whether a client's alert
    // is evaluated at all.
    const isWeekQuery = (text: string) => /date_trunc\('week', now\(\)\)/.test(text)

    const { sql, calls } = makeSql(call =>
      isWeekQuery(call.text) ? [{ current_scan_week: '2026-08-10' }] : [],
    )

    const snapshot = await createNeonAlertStore(sql).loadSnapshot()

    expect(snapshot.currentScanWeek).toBe('2026-08-10')
    expect(calls.some(call => isWeekQuery(call.text))).toBe(true)
  })
```

Note the responder returns `[]` for every other query, which drives `loadConfigs` down its zero-config early return. That is the path this test wants — it isolates the week lookup from config loading, and proves the week is fetched even when there are no configs (the early return must still carry it, per Step 4).

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/alerts/neon-store.test.ts`

Expected: FAIL — `currentScanWeek` is `undefined`, and TypeScript would also reject the property if tests were typechecked (they are excluded from `tsc --noEmit` in this repo, so the failure surfaces at runtime only).

- [x] **Step 3: Add the field to the snapshot type**

In `lib/alerts/evaluate.ts`, change the `AlertSnapshot` interface:

```ts
export interface AlertSnapshot {
  configs: AlertConfigWithClient[]
  weeksByClient: Record<string, AlertWeekSnapshot[]>
  emailsByAccount: Record<string, string | null | undefined>
  dashboardUrlByClient: Record<string, string | undefined>
  /**
   * The ISO Monday of the week the DATABASE believes it is now.
   *
   * Required, not optional, so every construction site is forced to supply it.
   * An optional field would let a caller omit it and silently disable the
   * staleness guard, which is the one thing this field exists to prevent.
   */
  currentScanWeek: string
}
```

- [x] **Step 4: Load it in the store**

In `lib/alerts/neon-store.ts`, add this function next to `loadEmailRows`:

```ts
/**
 * The Monday that starts the current ISO week, as Postgres reckons it.
 *
 * Deliberately a database round-trip rather than a `new Date()` call: the rows
 * this is compared against were written by `computeWeeklySummary` using
 * `date_trunc('week', ...)` on the same server, and two clocks that disagree
 * would make a healthy client look stale (or worse, the reverse).
 */
async function loadCurrentScanWeek(sql: Sql): Promise<string> {
  const rows = (await sql`
    SELECT date_trunc('week', now())::date AS current_scan_week
  `) as Array<{ current_scan_week: string | Date }>

  return isoDate(rows[0]?.current_scan_week, '')
}
```

Then wire it into `loadSnapshot`. The early return for "no configs" needs it too — return the same shape in both paths:

```ts
async function loadSnapshot(sql: Sql): Promise<AlertSnapshot> {
  const [configs, currentScanWeek] = await Promise.all([
    loadConfigs(sql),
    loadCurrentScanWeek(sql),
  ])
  if (!configs.length) {
    return {
      configs: [],
      weeksByClient: {},
      emailsByAccount: {},
      dashboardUrlByClient: {},
      currentScanWeek,
    }
  }
```

and add `currentScanWeek` to the final return object alongside `dashboardUrlByClient`:

```ts
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
    currentScanWeek,
  }
}
```

- [x] **Step 5: Run it to verify it passes**

Run: `npx vitest run __tests__/lib/alerts/neon-store.test.ts`

Expected: PASS, all tests in the file.

- [x] **Step 6: Fix the unit-test snapshot helper**

`__tests__/lib/alerts/evaluate.test.ts` builds snapshots with a `snapshot()` helper (line 22). Add the field so its fixtures stay valid — use the same week as the fixture's latest row, so existing tests keep firing their alerts:

```ts
const snapshot = (configs: AlertConfigWithClient[] = [config()]): AlertSnapshot => ({
  configs,
  weeksByClient: {
    'client-1': [
      { client_id: 'client-1', scan_week: '2026-08-08', sov_score: 40 },
      { client_id: 'client-1', scan_week: '2026-08-01', sov_score: 60 },
    ],
  },
  emailsByAccount: { 'account-1': 'owner@example.com' },
  dashboardUrlByClient: { 'client-1': 'https://app.example/en/dashboard/client-1' },
  // Matches weeksByClient[0] so the default fixture is fresh, not stale.
  currentScanWeek: '2026-08-08',
})
```

- [x] **Step 7: Run the alert suites**

Run: `npx vitest run __tests__/lib/alerts/ __tests__/api/cron/evaluate-alerts.test.ts`

Expected: PASS. The evaluator does not read `currentScanWeek` yet, so behaviour is unchanged — this task only makes the value available.

- [x] **Step 8: Commit**

```bash
git add lib/alerts/evaluate.ts lib/alerts/neon-store.ts __tests__/lib/alerts/neon-store.test.ts __tests__/lib/alerts/evaluate.test.ts
git commit -m "feat(alerts): carry the database's current scan week on the snapshot"
```

---

### Task 3: Skip stale clients instead of silently re-deriving last week

**Files:**
- Modify: `lib/alerts/evaluate.ts:73-183` (`runAlertEvaluation`)
- Test: `__tests__/lib/alerts/evaluate.test.ts`

- [x] **Step 1: Write the failing test**

Add these two tests to `__tests__/lib/alerts/evaluate.test.ts` inside `describe('runAlertEvaluation', ...)`:

```ts
  it('skips a client whose latest aggregate week is not the current week', async () => {
    // The silent drop this closes. With the rollup not yet landed, weeks[0] is
    // LAST week's row. The evaluator used to re-derive last week's action,
    // whose ledger row last week's run already claimed, so the claim returned
    // false and the outcome was 'suppressed' -- reported as
    // {fired: 1, emailed: 0, emailFailures: 0}, which is byte-identical to a
    // healthy idempotent re-run. The client's real current-week alert was never
    // computed and nothing anywhere said so.
    const data = snapshot()
    data.currentScanWeek = '2026-08-17'   // a week later than the fixture rows

    const { ports } = portsFor(data)

    const result = await runAlertEvaluation(ports)

    expect(result).toEqual({
      processed: 1,
      stale: 1,
      fired: 0,
      emailed: 0,
      deferred: 0,
      emailFailures: 0,
      notificationFailures: 0,
    })
    expect(ports.upsertNotification).not.toHaveBeenCalled()
    expect(ports.claimEmailDelivery).not.toHaveBeenCalled()
    expect(ports.sendAlertEmail).not.toHaveBeenCalled()
  })

  it('does not count a client with no weeks at all as stale', async () => {
    // A brand new client has never had a rollup. That is not the same fault as
    // a client whose rollup stopped landing, and conflating them would make the
    // stale counter fire on every legitimately new workspace.
    const data = snapshot()
    data.weeksByClient['client-1'] = []

    const { ports } = portsFor(data)

    const result = await runAlertEvaluation(ports)

    expect(result.stale).toBe(0)
    expect(result.fired).toBe(0)
  })
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/alerts/evaluate.test.ts`

Expected: FAIL. The first new test reports `fired: 1, emailed: 1` and no `stale` key — that failing output *is* the bug, printed. Several pre-existing tests also fail now because the expected object gained `stale` and `deferred`; Step 4 fixes them.

- [x] **Step 3: Implement the guard**

In `lib/alerts/evaluate.ts`, widen the return type of `runAlertEvaluation`:

```ts
export async function runAlertEvaluation(ports: AlertEvaluationPorts): Promise<{
  processed: number
  stale: number
  fired: number
  emailed: number
  deferred: number
  emailFailures: number
  notificationFailures: number
}> {
```

Add the counter next to the `actions` array:

```ts
  const snapshot = await ports.loadSnapshot()
  const actions: AlertAction[] = []
  let stale = 0
```

Then, in the `for (const config of snapshot.configs)` loop, insert the guard immediately after `latest` is read and **before** `latestScore` is used:

```ts
    const latest = weeks[0]
    const previous = weeks[1]

    // Evaluate only the current week. Without this the run re-derives last
    // week's action, the ledger claim for it already exists, and the outcome is
    // 'suppressed' -- indistinguishable from a healthy re-run while this
    // client's real alert is dropped. Nothing orders the Pulse rollup before
    // this cron except two schedule times three and a half hours apart.
    //
    // console.warn, not console.error: a lagging rollup 3.5 hours after
    // schedule is the expected transient case, not a code fault -- matching
    // how onboarding/complete already draws this line (warn for
    // degraded-but-non-fatal, error for real failures like a failed query or
    // an unset CRON_SECRET). The systemic case -- every client stale -- is
    // what escalates to a 502 downstream.
    if (latest.scan_week !== snapshot.currentScanWeek) {
      console.warn(
        `[alerts] client ${config.client_id}: latest aggregate week is ` +
        `${latest.scan_week}, expected ${snapshot.currentScanWeek} — skipping. ` +
        'The Pulse rollup has not landed for this client this week.',
      )
      stale++
      continue
    }

    const latestScore = latest.sov_score
    if (latestScore === null) continue
```

Finally add `stale` to the returned object (leave `deferred: 0` out for now — Task 5 adds it; the tests written in Step 1 expect it, so they stay red until then):

```ts
  return {
    processed: snapshot.configs.length,
    stale,
    fired: actions.length,
    emailed,
    deferred: 0,
    emailFailures,
    notificationFailures,
  }
```

> `deferred` is returned as a literal `0` here on purpose, so the return shape settles in one commit rather than churning every `toEqual` in the suite twice. Task 5 gives it a real value.

- [x] **Step 4: Update the six exact-shape assertions**

`__tests__/lib/alerts/evaluate.test.ts` asserts the result with `toEqual` in **6** places (search for `result).toEqual({ processed`). Add `stale: 0` and `deferred: 0` to each — every one of those tests uses the default fresh fixture, so both are zero.

For example, the first one becomes:

```ts
    expect(result).toEqual({
      processed: 1,
      stale: 0,
      fired: 2,
      emailed: 2,
      deferred: 0,
      emailFailures: 0,
      notificationFailures: 0,
    })
```

**Keep `toEqual`.** Do not weaken these to `toMatchObject` — exact-shape assertions are what would catch an unintended field appearing in an API response, and this result object is serialised straight to the cron's JSON body.

- [x] **Step 5: Run it to verify it passes**

Run: `npx vitest run __tests__/lib/alerts/evaluate.test.ts`

Expected: PASS, 16 tests.

- [x] **Step 6: Refresh the route test's mock payloads**

`__tests__/api/cron/evaluate-alerts.test.ts` stubs the evaluator with **6** `h.runAlertEvaluation.mockResolvedValue({...})` calls (lines 45, 119, 141, 169, 197, 219). These are *inputs*, not assertions, so they will not fail when the return type grows — they will quietly keep returning the old five-key object.

Add `stale: 0, deferred: 0` to every one of them. This matters more than it looks: Task 4 makes `evaluationStatus` read both keys, and a mock that omits them yields `undefined`. `undefined > 0` is `false` and `undefined === 3` is `false`, so every test would still pass — for the wrong reason, against a payload the real evaluator can no longer produce. That is a mock proving the absence of a behaviour it simply never exercises.

- [x] **Step 7: Run the whole unit suite**

Run: `npm run test:unit`

Expected: PASS. Report the file and test counts.

- [x] **Step 8: Commit**

```bash
git add lib/alerts/evaluate.ts __tests__/lib/alerts/evaluate.test.ts __tests__/api/cron/evaluate-alerts.test.ts
git commit -m "fix(alerts): skip stale clients rather than silently re-deriving last week"
```

---

### Task 4: A wholly stale run must not read as a green cron

**Files:**
- Modify: `app/api/cron/evaluate-alerts/route.ts:47-52` (`evaluationStatus`)
- Test: `__tests__/api/cron/evaluate-alerts.test.ts`

> **Superseded by Task 4b (2026-08-21).** The steps below shipped as written and are left
> intact as the historical record, but the rule they implement --
> `result.stale === result.processed` -- and this doc comment's claim that "every client
> stale ... means the Pulse rollup did not land at all" are **no longer what the code does**.
> A code review caught that `!weeks.length` (a client with no `pulse_weekly_summary` rows at
> all) is checked *before* the staleness comparison and `continue`s without incrementing
> `stale`, so that client trips neither counter. Since the Pulse rollup has never written a
> row in production (see CLAUDE.md), the case this task's own tests call "the systemic
> failure" -- a rollup that hasn't landed for anyone -- was exactly the case the
> `stale === processed` rule failed to catch: `{processed: N, stale: 0, fired: 0}` stayed
> 200. Task 4b replaces the rule with a separate `evaluated` counter and rewrites this doc
> comment for real. Read Task 4b for the current behaviour; treat everything below as "what
> shipped on 2026-08-16", not "what the route does today".

The route's own comment says it: *"Vercel Cron surfaces status codes, not response bodies"*. A `stale` counter that only appears in the JSON body is invisible in the deployment logs, which is the exact failure this plan exists to fix.

- [x] **Step 1: Write the failing test**

Add to `__tests__/api/cron/evaluate-alerts.test.ts`. Read the file first and match its existing mocking idiom for `runAlertEvaluation`.

```ts
  it('returns 502 when every configured client was stale', async () => {
    // Not a partial data gap -- this is "the evaluator ran and could not
    // evaluate anybody", which in practice means the Pulse rollup did not land
    // at all. A 200 here would show green in the Vercel Cron log every Monday
    // while no alert was ever computed.
    h.runAlertEvaluation.mockResolvedValue({
      processed: 3, stale: 3, fired: 0, emailed: 0,
      deferred: 0, emailFailures: 0, notificationFailures: 0,
    })
    const { GET } = await importRoute()

    const response = await GET(cronRequest('test-cron-secret') as never)

    expect(response.status).toBe(502)
  })

  it('stays 200 when only some clients were stale', async () => {
    // One client's rollup lagging is a per-client data gap, not a system fault,
    // and failing the whole cron for it would train people to ignore the alarm.
    // The per-client console.warn in the evaluator is the signal for this case.
    h.runAlertEvaluation.mockResolvedValue({
      processed: 3, stale: 1, fired: 2, emailed: 2,
      deferred: 0, emailFailures: 0, notificationFailures: 0,
    })
    const { GET } = await importRoute()

    const response = await GET(cronRequest('test-cron-secret') as never)

    expect(response.status).toBe(200)
  })

  it('returns 502 when the run was truncated before finishing', async () => {
    h.runAlertEvaluation.mockResolvedValue({
      processed: 400, stale: 0, fired: 300, emailed: 120,
      deferred: 180, emailFailures: 0, notificationFailures: 0,
    })
    const { GET } = await importRoute()

    const response = await GET(cronRequest('test-cron-secret') as never)

    expect(response.status).toBe(502)
  })
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/api/cron/evaluate-alerts.test.ts`

Expected: FAIL — all three new tests get `200`, because `evaluationStatus` reads only `emailFailures` and `notificationFailures`.

- [x] **Step 3: Implement the status rule**

In `app/api/cron/evaluate-alerts/route.ts`, replace `evaluationStatus` and extend its doc comment:

```ts
/**
 * A run with any delivery failure must not read as a green cron.
 *
 * `emailFailures` and `notificationFailures` exist specifically to distinguish
 * an outage (migration 035 unapplied, RESEND_API_KEY revoked, migration 033's
 * ON CONFLICT arbiter missing, ...) from a healthy re-run. Vercel Cron surfaces
 * status codes, not response bodies, so a totally failed run that still
 * returns 200 is invisible in the deployment logs -- every Monday shows green
 * while zero alerts go out. One function decides the status for both GET and
 * POST so they cannot drift apart.
 *
 * Two non-delivery faults join them, for the same reason:
 *
 *   deferred > 0        the run hit its time budget and stopped. Work remains
 *                       undone and Vercel Cron does not retry, so the next
 *                       attempt is seven days away.
 *   every client stale  the evaluator ran and could not evaluate anybody,
 *                       which means the Pulse rollup did not land at all.
 *
 * Partial staleness stays 200 deliberately: one client's rollup lagging is a
 * data gap rather than a system fault, and failing the cron for it would train
 * whoever reads these logs to ignore the alarm. That case is reported by the
 * per-client console.warn in runAlertEvaluation.
 */
function evaluationStatus(result: {
  processed: number
  stale: number
  deferred: number
  emailFailures: number
  notificationFailures: number
}): number {
  if (result.emailFailures > 0 || result.notificationFailures > 0) return 502
  if (result.deferred > 0) return 502
  if (result.processed > 0 && result.stale === result.processed) return 502
  return 200
}
```

- [x] **Step 4: Run it to verify it passes**

Run: `npx vitest run __tests__/api/cron/evaluate-alerts.test.ts`

Expected: PASS, every test in the file.

- [x] **Step 5: Commit**

```bash
git add app/api/cron/evaluate-alerts/route.ts __tests__/api/cron/evaluate-alerts.test.ts
git commit -m "feat(alerts): fail the cron when a run was wholly stale or truncated"
```

---

### Task 4b: Count clients actually evaluated, not just clients not stale

**Files:**
- Modify: `lib/alerts/evaluate.ts` (`runAlertEvaluation`)
- Modify: `app/api/cron/evaluate-alerts/route.ts` (`evaluationStatus`, `GET`, `POST`)
- Test: `__tests__/lib/alerts/evaluate.test.ts`
- Test: `__tests__/api/cron/evaluate-alerts.test.ts`

Added in response to a code review finding against Task 4. `runAlertEvaluation` (`lib/alerts/evaluate.ts:102`) does `if (!weeks.length) continue` **before** the staleness check. A client with no `pulse_weekly_summary` rows at all is therefore skipped silently -- not counted in `stale`, and with no log line at all. Driving `runAlertEvaluation` directly with a no-weeks client and a mixed no-weeks/stale pair proved it:

```
NO-WEEKS RESULT:   {"processed":2,"stale":0,"fired":0,...}  -> 200
MIXED-SKIP RESULT: {"processed":2,"stale":1,"fired":0,...}  -> 200
```

Per CLAUDE.md, the Pulse weekly rollup has never written a row in production. So the first Monday after anyone creates an `alert_config`, the cron produces exactly the first case above -- `processed: N, stale: 0, fired: 0` -- 200, green, invisible in both the status code and the logs. That is the silent-green failure this whole plan exists to close, in its most probable form. Task 4's doc comment claim that all-stale "means the Pulse rollup did not land at all" was therefore inverted: the total-non-landing case is the one that did *not* trip it.

The fix is not to fold no-weeks clients into `stale` -- that conflates a brand-new client that has never had a rollup with a client whose rollup stopped landing, and would fire the stale counter on every new workspace (`__tests__/lib/alerts/evaluate.test.ts`'s `'does not count a client with no weeks at all as stale, or as evaluated'` pins the distinction). The fix is a separate counter for "did we evaluate anybody at all".

- [x] **Step 1: Add the `evaluated` counter**

In `lib/alerts/evaluate.ts`, widen the return type (`evaluated` sits next to `processed` and `stale` so the shape reads in pipeline order) and increment the counter only after every skip condition has passed:

```ts
export async function runAlertEvaluation(ports: AlertEvaluationPorts): Promise<{
  processed: number
  stale: number
  evaluated: number
  fired: number
  emailed: number
  deferred: number
  emailFailures: number
  notificationFailures: number
}> {
  const snapshot = await ports.loadSnapshot()
  const actions: AlertAction[] = []
  let stale = 0
  let evaluated = 0

  for (const config of snapshot.configs) {
    const weeks = snapshot.weeksByClient[config.client_id] ?? []
    if (!weeks.length) continue          // not stale, not evaluated

    const latest = weeks[0]
    const previous = weeks[1]

    if (latest.scan_week !== snapshot.currentScanWeek) {
      console.warn(/* ... */)
      stale++
      continue                            // stale, not evaluated
    }

    const latestScore = latest.sov_score
    if (latestScore === null) continue    // not stale, not evaluated

    evaluated++                           // every skip condition passed

    const previousScore = previous?.sov_score
    // ... policy checks, unchanged ...
  }

  // ...
  return {
    processed: snapshot.configs.length,
    stale,
    evaluated,
    fired: actions.length,
    emailed,
    deferred: 0,
    emailFailures,
    notificationFailures,
  }
}
```

`evaluated` is deliberately not `fired`: a client can be fully evaluated and legitimately trigger no alert. That is the healthy common case and must stay 200 (`'counts a healthy fresh client as evaluated even when no alert fires'`).

- [x] **Step 2: Replace the status rule**

In `app/api/cron/evaluate-alerts/route.ts`:

```ts
function evaluationStatus(result: {
  processed: number
  evaluated: number
  deferred: number
  emailFailures: number
  notificationFailures: number
}): number {
  if (result.emailFailures > 0 || result.notificationFailures > 0) {
    console.error(`[cron/evaluate-alerts] 502: emailFailures=${result.emailFailures} notificationFailures=${result.notificationFailures}`)
    return 502
  }
  if (result.deferred > 0) {
    console.error(`[cron/evaluate-alerts] 502: deferred=${result.deferred} alert(s) past the time budget`)
    return 502
  }
  if (result.processed > 0 && result.evaluated === 0) {
    console.error(`[cron/evaluate-alerts] 502: evaluated 0 of ${result.processed} configured client(s) -- the Pulse rollup likely never landed`)
    return 502
  }
  return 200
}
```

`stale` is dropped from the parameter type -- `evaluationStatus` no longer reads it, so keeping it in the signature would be a lying type. It stays in `runAlertEvaluation`'s return shape and the JSON body; only the status decision stopped using it directly. The rule is now "the evaluator ran against at least one config and evaluated none of them", which covers a rollup that is a week behind (all stale), a rollup that has never written a row (all no-weeks -- the case production is actually in), a mix of the two, and every client having a null score, uniformly.

Each 502 branch also gets one `console.error` naming which rule tripped, addressing the route's own comment -- *"Vercel Cron surfaces status codes, not response bodies"* -- applying to the cause as much as the failure. The per-client detail still lives in `evaluate.ts`'s `console.warn`; this is one line per run, not a re-dump.

- [x] **Step 3: Update the doc comment**

Rewrote `evaluationStatus`'s JSDoc to state the corrected rule plainly (see the function in `app/api/cron/evaluate-alerts/route.ts` for the shipped text) and added half a line noting that `deferred > 0` is currently unreachable -- `runAlertEvaluation` returns the literal `0` until Task 5 adds the producer that gives it a real value, so a reader does not go hunting for a time budget that does not exist yet.

- [x] **Step 4: Tests**

`__tests__/lib/alerts/evaluate.test.ts`:
- `'does not count a client with no weeks at all as stale, or as evaluated'` (extended from Task 3's test) -- `evaluated: 0` while `stale` stays `0`, pinning the exact distinction that motivated this task.
- `'counts a healthy fresh client as evaluated even when no alert fires'` -- `evaluated: 1` with `fired: 0`, guarding against conflating the two counters.
- Every pre-existing full-shape `toEqual`/`resolves.toEqual` assertion on the result (9 sites, not the 7 originally estimated -- two were added by Task 3's own follow-up commit `dac061e` after this plan's count was written) gained `evaluated` at its correct value for that fixture.

`__tests__/api/cron/evaluate-alerts.test.ts`:
- `{processed: 2, evaluated: 0, stale: 0, ...}` -> **502**, both GET and POST (the never-written-a-row case; this is the one that used to be green). Task 4's own tests only exercised GET; this task adds the mirrored POST case per the file's convention of covering every 502 rule on both handlers.
- `{processed: 2, evaluated: 1, stale: 1, ...}` -> **200** (mixed: one stale, one evaluated).
- `{processed: 0, ...}` empty run still -> **200** (unchanged, reconfirmed with `evaluated: 0` added).
- All 13 `mockResolvedValue` payloads (not 7 -- three were added by Task 4's own tests after this plan's estimate, and this task adds two more) gained `evaluated` at a value consistent with their scenario.

- [x] **Step 5: Run the whole unit suite, lint, typecheck**

Run: `npm run test:unit && npm run lint && npm run typecheck`

Result: **142 files / 1572 tests** passed (up from the 142/1568 baseline this task started from -- 4 new tests). Lint: 0 errors, 0 warnings. Typecheck: exit 0.

- [x] **Step 6: Prove it bites**

Temporarily reverted `evaluationStatus` to the old `result.stale === result.processed` rule (re-adding `stale: number` to its parameter type) and re-ran the two new "evaluated nobody" tests:

```
 FAIL  __tests__/api/cron/evaluate-alerts.test.ts > POST /api/cron/evaluate-alerts > returns 502 when the run evaluated nobody, mirroring the GET handler
AssertionError: expected 200 to be 502

 FAIL  __tests__/api/cron/evaluate-alerts.test.ts > GET /api/cron/evaluate-alerts > returns 502 when the evaluator ran but evaluated nobody, even with zero stale clients
AssertionError: expected 200 to be 502
```

Both fail with 200 under the old rule, confirming `{processed: 2, stale: 0, evaluated: 0}` is exactly the case it missed. Restored by re-editing back to `result.evaluated === 0` (not `git checkout`, to avoid discarding other uncommitted work in the same file) and confirmed the restored file is byte-identical to the pre-revert version before re-running the full suite green.

- [x] **Step 7: Commit**

```bash
git add lib/alerts/evaluate.ts app/api/cron/evaluate-alerts/route.ts \
  __tests__/lib/alerts/evaluate.test.ts __tests__/api/cron/evaluate-alerts.test.ts \
  docs/superpowers/plans/2026-08-16-harden-alert-evaluator.md
git commit -m "fix(alerts): fail the cron when it evaluated nobody, not just when all were stale"
```

Deliberately out of scope, matching this plan's Task 5/6 boundary: no concurrency, no time budget, and `deferred` stays the literal `0` -- that is Task 5's work, untouched here.

---

### Task 5: Bound the delivery loop by clients, and report what it could not reach

**Files:**
- Modify: `lib/alerts/evaluate.ts:153-183` (the delivery loop and return)
- Test: `__tests__/lib/alerts/evaluate.test.ts`

Two changes, both narrow. Run **clients** concurrently rather than alerts, and stop on a time budget instead of running until the platform kills the function.

Grouping by client is not incidental. Two actions for the same client (a threshold crossing and a week-over-week drop) must stay ordered — `__tests__/lib/alerts/evaluate.test.ts` asserts `toHaveBeenNthCalledWith(1, ... 'sov_threshold')` then `(2, ... 'sov_wow_drop')`, and that ordering is what makes the emails read sensibly. Parallelising across clients preserves it; parallelising across actions destroys it.

- [x] **Step 1: Write the failing test**

Add to `__tests__/lib/alerts/evaluate.test.ts`:

```ts
  it('stops on the time budget and reports the alerts it did not reach', async () => {
    // Truncation used to be silent: the function was killed mid-loop at
    // maxDuration, and because loadConfigs orders by ac.id ASC it was the same
    // suffix of customers every week, with no cron retry for seven days.
    const configs = Array.from({ length: 4 }, (_, index) =>
      config({
        id: `alert-${index}`,
        client_id: `client-${index}`,
        client: { id: `client-${index}`, brand_name: `Brand ${index}`, account_id: `account-${index}` },
      }),
    )
    const data = snapshot(configs)
    for (const item of configs) {
      data.weeksByClient[item.client_id] = [
        { client_id: item.client_id, scan_week: '2026-08-08', sov_score: 40 },
        { client_id: item.client_id, scan_week: '2026-08-01', sov_score: 60 },
      ]
      data.emailsByAccount[item.client.account_id] = 'owner@example.com'
      data.dashboardUrlByClient[item.client_id] = 'https://app.example/d'
    }

    const { ports } = portsFor(data)

    // A clock that jumps a full budget on its second read, so the first group
    // of clients is delivered and everything after it is deferred.
    let reads = 0
    const now = () => (reads++ === 0 ? 0 : 999_999)

    const result = await runAlertEvaluation(ports, { concurrency: 1, budgetMs: 1_000, now })

    expect(result.deferred).toBeGreaterThan(0)
    expect(result.emailed + result.deferred).toBe(result.fired)
  })

  it('keeps one client\'s alerts in order while running clients concurrently', async () => {
    // Concurrency is per client, never per alert: a threshold crossing and a
    // week-over-week drop for the same brand must arrive in that order.
    const { ports, order } = portsFor()

    await runAlertEvaluation(ports, { concurrency: 8 })

    expect(order).toEqual([
      'notification:sov_threshold',
      'email:sov_threshold',
      'notification:sov_wow_drop',
      'email:sov_wow_drop',
    ])
  })
```

- [x] **Step 2: Run it to verify it fails**

Run: `npx vitest run __tests__/lib/alerts/evaluate.test.ts`

Expected: FAIL — `runAlertEvaluation` takes one argument, so the options are ignored and `deferred` is the literal `0` from Task 3.

- [x] **Step 3: Implement it**

In `lib/alerts/evaluate.ts`, add the options type above `runAlertEvaluation`:

```ts
export interface AlertEvaluationOptions {
  /**
   * How many CLIENTS to deliver concurrently. Not alerts: a client's own
   * alerts stay sequential so a threshold crossing cannot overtake the
   * week-over-week drop that accompanies it.
   */
  concurrency?: number
  /**
   * Wall-clock budget for the delivery phase. Below `vercel.json`'s 60s
   * maxDuration for this route, so the run stops itself and says what it
   * skipped instead of being killed mid-send with nothing reported.
   */
  budgetMs?: number
  /** Injected so the budget is testable without a real clock. */
  now?: () => number
}
```

Change the signature:

```ts
export async function runAlertEvaluation(
  ports: AlertEvaluationPorts,
  options: AlertEvaluationOptions = {},
): Promise<{
```

Then replace the whole delivery loop — everything from `let emailed = 0` down to the `return` — with:

```ts
  const { concurrency = 8, budgetMs = 45_000, now = Date.now } = options

  let emailed = 0
  let emailFailures = 0
  let notificationFailures = 0
  let deferred = 0

  // Group first, so the unit of concurrency is the client.
  const byClient = new Map<string, AlertAction[]>()
  for (const action of actions) {
    const key = action.notification?.client_id ?? action.emailKey?.client_id ?? ''
    byClient.set(key, [...(byClient.get(key) ?? []), action])
  }

  const deliverOne = async (action: AlertAction) => {
    if (action.notification) {
      try {
        await ports.upsertNotification(action.notification)
      } catch (error) {
        console.error('[alerts] notification failed:', error)
        notificationFailures++
      }
    }

    if (action.email && action.emailKey) {
      const outcome = await deliverEmail(ports, action.email, action.emailKey)
      if (outcome === 'sent') emailed++
      else if (outcome === 'failed') emailFailures++
      // 'suppressed' means this key was already delivered this scan_week —
      // a healthy re-run, not a failure, so it counts toward neither total.
    }
  }

  const groups = [...byClient.values()]
  const startedAt = now()

  for (let index = 0; index < groups.length; index += concurrency) {
    const batch = groups.slice(index, index + concurrency)

    // Checked per batch rather than per alert: one batch is bounded work, and
    // stopping here leaves the ledger consistent -- an alert is either fully
    // delivered or never claimed.
    if (now() - startedAt > budgetMs) {
      const remaining = groups.slice(index)
      deferred = remaining.reduce((total, group) => total + group.length, 0)
      console.error(
        `[alerts] time budget exhausted after ${index} of ${groups.length} clients; ` +
        `${deferred} alert(s) deferred. Vercel Cron does not retry — these wait a week.`,
      )
      break
    }

    await Promise.all(batch.map(async group => {
      for (const action of group) await deliverOne(action)
    }))
  }

  return {
    processed: snapshot.configs.length,
    stale,
    fired: actions.length,
    emailed,
    deferred,
    emailFailures,
    notificationFailures,
  }
```

- [x] **Step 4: Run it to verify it passes**

Run: `npx vitest run __tests__/lib/alerts/evaluate.test.ts`

Expected: PASS, 18 tests.

- [x] **Step 5: Pass the real budget from the route**

In `app/api/cron/evaluate-alerts/route.ts`, change `evaluateAlerts` so the budget is stated where the timeout it defends against is configured:

```ts
function evaluateAlerts() {
  const ports: AlertEvaluationPorts = {
    ...createNeonAlertStore(db()),
    sendAlertEmail: deliverAlertEmail,
  }
  // vercel.json gives this route maxDuration 60. Stop at 45s so the run
  // reports what it deferred instead of being killed mid-loop, which reports
  // nothing at all.
  return runAlertEvaluation(ports, { budgetMs: 45_000 })
}
```

- [x] **Step 6: Run the whole unit suite**

Run: `npm run test:unit`

Expected: PASS, all files. Report the counts.

- [x] **Step 7: Commit**

```bash
git add lib/alerts/evaluate.ts app/api/cron/evaluate-alerts/route.ts __tests__/lib/alerts/evaluate.test.ts
git commit -m "feat(alerts): deliver clients concurrently under a time budget"
```

---

### Task 6: Correct the release doc

**Files:**
- Modify: `docs/alert-evaluation-release.md` (the "Known limitations to accept or mitigate" section)

Two of the three bullets there describe behaviour this plan changed. Leaving them is the same failure Task 5 of the Pulse plan fixed — documentation asserting a defect that no longer exists sends the next person to the wrong place.

- [x] **Step 1: Replace the truncation bullet**

Find the bullet beginning **"The delivery loop is serial and bounded by wall clock, not by row count."** Keep the analysis — it is accurate about why the shape is dangerous — and replace its final sentence (`Mitigation if it becomes real: ...`) with:

```markdown
  **Mitigated, not solved (2026-08-16).** Delivery now runs 8 clients
  concurrently — per client, so one brand's threshold and week-over-week alerts
  stay ordered — and stops at a 45s budget against the 60s `maxDuration`. That
  moves the ceiling roughly an order of magnitude and, more importantly, makes
  hitting it loud: the run reports `deferred > 0` and the route answers 502
  rather than being killed mid-loop with nothing recorded. The underlying shape
  is unchanged, so at genuine scale the answer is still the chunk-and-chain that
  `cron/pulse` uses, or a lease/TTL on the claim. There are zero `alert_configs`
  rows today, so that work would be speculative.
```

- [x] **Step 2: Replace the staleness bullet**

Find the bullet beginning **"Nothing enforces that the week's Pulse rollup landed before alerts read it."** Replace the whole bullet with:

```markdown
- **The evaluator now refuses to read a stale week (2026-08-16).** Nothing still
  enforces that the rollup lands first — the ordering rests on two cron times
  three and a half hours apart — but the consequence has changed. Previously the
  evaluator re-derived last week's action, whose ledger row last week's run had
  already claimed, so the claim returned false, the outcome was `suppressed`,
  and the run reported `emailed: 0, emailFailures: 0` — indistinguishable from a
  healthy idempotent re-run while that client's genuine current-week alert was
  dropped. `runAlertEvaluation` now compares each client's latest aggregate week
  against `date_trunc('week', now())` as read from Postgres (never the app
  clock, which would disagree across timezones) and skips any client whose week
  is behind, counting it in `stale` and logging the client id. A client with no
  weeks at all is not counted — a new workspace is not a fault. If **every**
  configured client is stale the route answers 502, because that means the
  rollup did not land at all; partial staleness stays 200 and relies on the
  per-client log line.
```

- [x] **Step 3: Verify no other doc still states the old behaviour**

Run:

```bash
grep -rn "emailed: 0\|serial and bounded\|staleness guard" docs/*.md | grep -v superpowers/plans
```

Report every hit and fix any that now misdescribe the code. Do **not** edit anything under `docs/superpowers/plans/` — those are historical records of what was believed at the time.

- [x] **Step 4: Commit**

```bash
git add docs/alert-evaluation-release.md
git commit -m "docs(alerts): record the staleness guard and the bounded delivery loop"
```

---

### Task 7: Prove the guard against a real database

**Files:**
- Create: `__tests__/integration/alert-staleness.test.ts`

The unit tests use a hand-built snapshot, so they prove the evaluator's logic but not that `loadCurrentScanWeek` agrees with what `computeWeeklySummary` actually wrote. Only real SQL can show that, and this is precisely the class of gap that let the `031` arbiter bug reach production.

Follow `docs/runbooks/verify-pulse-rollup.md`: the harness provisions and deletes its own branch. **Never set `TEST_DATABASE_URL` yourself.**

- [ ] **Step 1: Write the test**

Create `__tests__/integration/alert-staleness.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { neon } from '@neondatabase/serverless'

import { createNeonAlertStore } from '@/lib/alerts/neon-store'

const sql = neon(process.env.TEST_DATABASE_URL!)

const CLIENT = '77777777-7777-7777-7777-777777777777'
const ACCOUNT = '88888888-8888-8888-8888-888888888888'

/**
 * The unit suite hand-builds the snapshot, so it can prove the evaluator skips
 * a stale week but not that `loadCurrentScanWeek` produces the same string
 * `computeWeeklySummary` writes into `scan_week`. A one-day disagreement
 * between those two -- a timezone, a `toISOString()`, a `::date` cast -- would
 * make EVERY client look stale forever, and no mocked test can see it.
 */
async function seed() {
  await sql`delete from alert_configs where client_id = ${CLIENT}`
  await sql`delete from pulse_weekly_summary where client_id = ${CLIENT}`
  await sql`delete from clients where id = ${CLIENT}`
  await sql`delete from accounts where id = ${ACCOUNT}`
  await sql`insert into accounts (id, plan, status) values (${ACCOUNT}, 'pro', 'active')`
  await sql`
    insert into clients (id, account_id, brand_name, status, competitors)
    values (${CLIENT}, ${ACCOUNT}, 'Stale Co', 'active', ${[]}::text[])
  `
  await sql`
    insert into alert_configs
      (client_id, enabled_sov, sov_threshold, enabled_wow, wow_threshold, notify_email, notify_inapp)
    values (${CLIENT}, true, 50, true, 10, false, true)
  `
}

describe('alert snapshot staleness', () => {
  beforeEach(seed)

  it('reports the same week string that the rollup writes', async () => {
    await sql`
      insert into pulse_weekly_summary (client_id, scan_week, platform, sov_score)
      values (${CLIENT}, date_trunc('week', now())::date, null, 40)
    `

    const snapshot = await createNeonAlertStore(sql).loadSnapshot()

    expect(snapshot.currentScanWeek).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(snapshot.weeksByClient[CLIENT][0].scan_week).toBe(snapshot.currentScanWeek)
  })

  it('marks a client whose newest aggregate week is last week', async () => {
    await sql`
      insert into pulse_weekly_summary (client_id, scan_week, platform, sov_score)
      values (${CLIENT}, (date_trunc('week', now()) - interval '7 days')::date, null, 40)
    `

    const snapshot = await createNeonAlertStore(sql).loadSnapshot()

    expect(snapshot.weeksByClient[CLIENT][0].scan_week).not.toBe(snapshot.currentScanWeek)
  })
})
```

- [ ] **Step 2: Run the integration suite**

Run: `REQUIRE_INTEGRATION_TESTS=1 npm run test:integration`

Expected: PASS, 8 files / 38 tests (7 files / 36 before this task).

`REQUIRE_INTEGRATION_TESTS=1` turns a skip into a failure — without it, a missing `neonctl` reports success having run nothing.

- [ ] **Step 3: Prove the first test can fail**

That test is the one that would catch a timezone disagreement, so confirm it bites. In `lib/alerts/neon-store.ts`, temporarily break `loadCurrentScanWeek` by shifting the week:

```ts
    SELECT (date_trunc('week', now()) - interval '1 day')::date AS current_scan_week
```

Run: `REQUIRE_INTEGRATION_TESTS=1 npm run test:integration`

Expected: FAIL on `'reports the same week string that the rollup writes'`.

Restore it — do not hand-edit it back:

```bash
git checkout lib/alerts/neon-store.ts
```

Re-run and confirm green, and that `git status --short` shows no change to that file.

- [ ] **Step 4: Full verification**

```bash
npm run lint && npm run typecheck && npm run test:unit
```

Then:

```bash
REQUIRE_INTEGRATION_TESTS=1 npm run test:integration
```

Expected: lint 0 errors / 0 warnings, typecheck exit 0, both suites green. Report all counts.

- [ ] **Step 5: Commit**

```bash
git add __tests__/integration/alert-staleness.test.ts
git commit -m "test(alerts): prove the staleness guard against real SQL"
```

---

## What this plan deliberately does not do

- **It does not add a lease or TTL to the email claim.** The gap is real and documented in `deliverEmail`'s comment: a process death between a successful claim and the send strands that alert for the week. Tasks 5's budget makes the *timeout* path far less likely, but a redeploy or host crash can still do it. A lease is the right fix and it is a different plan.
- **It does not chunk-and-chain the evaluator.** With zero `alert_configs` rows, building the `cron/pulse` driver shape here would be speculative. Task 5 makes the ceiling visible so the decision can be taken on evidence.
- **It does not make the Pulse rollup a hard precondition.** The evaluator now refuses stale data rather than reading it, which is the property that matters. Ordering the two crons properly — a driver that runs alerts only after confirming the rollup wrote this week — is a larger change to the scheduling model.
- **It does not seed any data.** Task 7 uses a throwaway branch precisely so nothing is written to a real workspace to make a test pass.

## Self-review notes

- **Return-shape churn is contained to one commit.** Task 3 adds both `stale` and `deferred` even though `deferred` stays literal `0` until Task 5, so the 6 `toEqual` assertions are rewritten once rather than twice.
- **Names are consistent throughout:** `isoDate(value, fallback)`, `loadCurrentScanWeek(sql)`, `AlertSnapshot.currentScanWeek`, `AlertEvaluationOptions.{concurrency,budgetMs,now}`, and result keys `processed / stale / fired / emailed / deferred / emailFailures / notificationFailures`.
- **Task ordering is load-bearing.** Task 1 must precede Task 2, because `loadCurrentScanWeek` uses `isoDate` on a value the driver may hand back as a `Date`.
- **One risk not eliminated:** `evaluationStatus` treats `stale === processed` as a fault. A deployment where every client is legitimately new (no weeks at all) reports `stale: 0`, so it stays 200 — verified by the second test in Task 3, Step 1.

Two defects were found in this plan during review and fixed in place, both worth knowing about because they are the kind an implementer inherits silently:

- Task 2's test originally hand-rolled a tagged-template `sql` fake. `__tests__/lib/alerts/neon-store.test.ts` already has `makeSql(respond)` with a `{ text, params }` responder, correctly typed as `NeonQueryFunction<false, false>`. The plan now uses it.
- Task 3 originally called the six `mockResolvedValue` payloads in `__tests__/api/cron/evaluate-alerts.test.ts` "expectations". They are inputs. Left stale they would feed `undefined` into Task 4's new status rules, and every test would pass for the wrong reason. The plan now spells out why they must be updated even though nothing fails if they are not.

Both were caught by reading the files rather than trusting the plan's own description of them — which is the same discipline the tasks themselves demand.
