# Alert Evaluation Module Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move alert snapshot loading, independent SoV crossing policy, notification composition, and sequential fail-soft delivery behind one typed alert evaluation module while preserving the cron route contract.

**Architecture:** `lib/alerts/evaluate.ts` will be the deep module. It will consume a normalized `AlertSnapshot` through a `loadSnapshot` port, create independent alert actions for threshold, week-over-week drop, and recovery policies, then execute `upsertNotification` and `sendAlertEmail` ports in deterministic order. `app/api/cron/evaluate-alerts/route.ts` will remain a thin cron adapter responsible for `CRON_SECRET`, Supabase/Resend adapter construction, and the `{ processed, fired }` response.

**Tech Stack:** TypeScript, Next.js route handlers, Supabase service-role client, Resend, Vitest.

## Global Constraints

- Preserve `500 { error: 'Cron not configured' }` when `CRON_SECRET` is absent.
- Preserve `401 { error: 'Unauthorized' }` for a missing or mismatched `x-cron-secret`.
- Preserve successful response shape `{ processed, fired }`.
- Preserve independent policy behavior: one client may produce `sov_threshold`, `sov_wow_drop`, and/or `sov_recovery` actions in one run.
- Count `fired` when a policy crossing is detected, even when a delivery adapter fails.
- Abort the run when snapshot loading fails; continue later actions when a notification or email adapter fails.
- Deliver actions sequentially, writing the in-app notification before attempting email for each action.
- Keep Supabase row shapes, service-role credentials, Resend construction, and environment variables behind route-owned adapters.
- Do not make live Supabase, auth-admin, Resend, or scheduler calls from tests.

---

### Task 1: Define the evaluator seam with a failing contract test

**Files:**
- Create: `__tests__/lib/alerts/evaluate.test.ts`
- Create later: `lib/alerts/evaluate.ts`

**Interfaces:**
- The test will consume `runAlertEvaluation`, `AlertSnapshot`, `AlertEvaluationPorts`, and `AlertConfigWithClient` from `@/lib/alerts/evaluate`.
- `runAlertEvaluation(ports: AlertEvaluationPorts): Promise<{ processed: number; fired: number }>` will be the only production entry point used by the route.

- [ ] **Step 1: Write the failing tests**

```ts
import { describe, expect, it, vi } from 'vitest'
import {
  runAlertEvaluation,
  type AlertConfigWithClient,
  type AlertEvaluationPorts,
  type AlertSnapshot,
} from '@/lib/alerts/evaluate'

const config = (overrides: Partial<AlertConfigWithClient> = {}): AlertConfigWithClient => ({
  id: 'alert-1',
  client_id: 'client-1',
  enabled_sov: true,
  sov_threshold: 50,
  enabled_wow: true,
  wow_threshold: 10,
  notify_inapp: true,
  notify_email: true,
  client: { id: 'client-1', brand_name: 'Acme', account_id: 'account-1' },
  ...overrides,
})

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
})

function portsFor(data: AlertSnapshot = snapshot()) {
  const order: string[] = []
  const ports: AlertEvaluationPorts = {
    loadSnapshot: vi.fn().mockResolvedValue(data),
    upsertNotification: vi.fn(async notification => { order.push(`notification:${notification.type}`) }),
    sendAlertEmail: vi.fn(async email => { order.push(`email:${email.type}`) }),
  }
  return { ports, order }
}

describe('runAlertEvaluation', () => {
  it('creates independent threshold and week-over-week actions for one client', async () => {
    const { ports } = portsFor()

    const result = await runAlertEvaluation(ports)

    expect(result).toEqual({ processed: 1, fired: 2 })
    expect(ports.upsertNotification).toHaveBeenCalledTimes(2)
    expect(ports.sendAlertEmail).toHaveBeenCalledTimes(2)
    expect(ports.upsertNotification).toHaveBeenNthCalledWith(1, expect.objectContaining({ type: 'sov_threshold' }))
    expect(ports.upsertNotification).toHaveBeenNthCalledWith(2, expect.objectContaining({ type: 'sov_wow_drop' }))
  })

  it('evaluates all actions before delivering them in deterministic order', async () => {
    const { ports, order } = portsFor()

    await runAlertEvaluation(ports)

    expect(order).toEqual([
      'notification:sov_threshold', 'email:sov_threshold',
      'notification:sov_wow_drop', 'email:sov_wow_drop',
    ])
  })

  it('continues after notification or email adapter failures', async () => {
    const { ports } = portsFor()
    vi.mocked(ports.upsertNotification).mockRejectedValueOnce(new Error('notification unavailable'))
    vi.mocked(ports.sendAlertEmail).mockRejectedValueOnce(new Error('email unavailable'))

    await expect(runAlertEvaluation(ports)).resolves.toEqual({ processed: 1, fired: 2 })
    expect(ports.upsertNotification).toHaveBeenCalledTimes(2)
    expect(ports.sendAlertEmail).toHaveBeenCalledTimes(2)
  })

  it('propagates snapshot-loading failures without attempting delivery', async () => {
    const { ports } = portsFor()
    vi.mocked(ports.loadSnapshot).mockRejectedValueOnce(new Error('snapshot unavailable'))

    await expect(runAlertEvaluation(ports)).rejects.toThrow('snapshot unavailable')
    expect(ports.upsertNotification).not.toHaveBeenCalled()
    expect(ports.sendAlertEmail).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run the focused test to verify the expected failure**

Run: `npm.cmd test -- --run __tests__/lib/alerts/evaluate.test.ts`

Expected: FAIL because `@/lib/alerts/evaluate` does not exist yet. Fix only test setup errors; do not add production code before the missing-module failure is observed.

### Task 2: Implement the normalized evaluator and make the contract green

**Files:**
- Create: `lib/alerts/evaluate.ts`
- Test: `__tests__/lib/alerts/evaluate.test.ts`

**Interfaces:**
- `AlertConfigWithClient` contains the existing alert flags, thresholds, notification preferences, and normalized client identity.
- `AlertSnapshot` contains `configs`, two ordered weeks per client, account email lookup, and dashboard URLs.
- `AlertEvaluationPorts` contains only `loadSnapshot`, `upsertNotification`, and `sendAlertEmail`.
- The evaluator returns `{ processed: snapshot.configs.length, fired: actions.length }`.

- [ ] **Step 1: Add the minimal typed policy implementation**

Implement `runAlertEvaluation` so it loads one snapshot, creates actions in config order, evaluates the three independent policies, and executes each action as:

```ts
try { await ports.upsertNotification(action.notification) } catch (error) { console.error('[alerts] notification failed:', error) }
try { await ports.sendAlertEmail(action.email) } catch (error) { console.error('[alerts] email failed:', error) }
```

The threshold policy fires when the latest score is below threshold and the previous score is absent or at/above threshold. The week-over-week policy fires when the previous score minus latest score meets `wow_threshold`. The recovery policy fires when latest is at/above the SoV threshold and previous is below it. No policy suppresses another policy.

- [ ] **Step 2: Run the focused test to verify green**

Run: `npm.cmd test -- --run __tests__/lib/alerts/evaluate.test.ts`

Expected: 4 tests pass. If a delivery or failure-semantics assertion fails, fix the implementation rather than weakening the test.

### Task 3: Add route-owned Supabase and Resend adapters behind the evaluator

**Files:**
- Modify: `app/api/cron/evaluate-alerts/route.ts`
- Modify: `lib/resend.ts` only if the adapter needs a typed email payload bridge
- Create: `__tests__/api/cron/evaluate-alerts.test.ts`
- Test: `__tests__/lib/alerts/evaluate.test.ts`

**Interfaces:**
- The route will construct `AlertEvaluationPorts` from the existing service-role Supabase client and `sendAlertEmail` function.
- The snapshot loader will batch `alert_configs`, `pulse_weekly_summary`, and `profiles` queries, call `auth.admin.getUserById` once per account, keep the newest two aggregate weeks per client, and return normalized `AlertSnapshot` data.
- `upsertNotification` will preserve `onConflict: 'client_id,type,scan_week'` and `ignoreDuplicates: true`.
- The route will keep its current auth guard and return `Response.json(result)` for success.

- [ ] **Step 1: Write failing route contract tests**

Add tests for missing secret (`500`), wrong secret (`401`), and a valid secret delegating to the evaluator and returning `{ processed: 1, fired: 1 }`. Mock only the evaluator boundary and the route's Supabase client construction; do not connect to Supabase or Resend.

- [ ] **Step 2: Run the route tests and verify the expected failure**

Run: `npm.cmd test -- --run __tests__/api/cron/evaluate-alerts.test.ts`

Expected: FAIL because the route still contains the old inline evaluator and does not delegate to `runAlertEvaluation`.

- [ ] **Step 3: Replace the inline route implementation with adapters**

Leave the security guard at the top of `POST`, construct the typed ports, call `runAlertEvaluation`, and map snapshot-loading errors to a 500 response with the existing framework-level failure behavior preserved for callers.

- [ ] **Step 4: Run focused route and evaluator tests**

Run: `npm.cmd test -- --run __tests__/lib/alerts/evaluate.test.ts __tests__/api/cron/evaluate-alerts.test.ts __tests__/api/alerts.test.ts`

Expected: all focused tests pass with no live provider calls.

### Task 4: Verify compatibility and refactor quality

**Files:**
- Modify only files identified by a failing verification result.

- [ ] **Step 1: Run the full test suite**

Run: `npm.cmd test`

Expected: all baseline tests plus the new evaluator and route tests pass.

- [ ] **Step 2: Run changed-file lint and TypeScript**

Run: `npm.cmd exec eslint -- app/api/cron/evaluate-alerts/route.ts lib/alerts/evaluate.ts __tests__/lib/alerts/evaluate.test.ts __tests__/api/cron/evaluate-alerts.test.ts` and `npm.cmd exec tsc -- --noEmit`.

Expected: no diagnostics in changed files and no TypeScript errors.

- [ ] **Step 3: Run repository lint and production build**

Run: `npm.cmd run lint` and `npm.cmd run build` with a process-local 32+ character `NEON_AUTH_COOKIE_SECRET` if the existing local auth validation requires it.

Expected: no lint errors; build completes or reports only the known multiple-lockfile workspace-root warning and unrelated baseline warnings.

- [ ] **Step 4: Review the diff and status**

Run: `git diff --check` and `git status --short --branch`.

Expected: only the alert evaluator plan, module, route, and tests are changed in `codex/alert-evaluation`; no production secret or generated build output is tracked.
