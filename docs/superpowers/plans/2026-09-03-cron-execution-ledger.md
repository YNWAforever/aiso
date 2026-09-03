# Cron execution ledger — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make it possible to tell whether the three scheduled cron routes are running, which nothing currently can.

**Architecture:** A `cron_runs` table written twice per invocation — a start row before the job acts, a completion update after. A thin recorder module the routes call. A wiring assertion that fails if a route forgets to call it.

**Tech Stack:** Neon Postgres, Next.js 16 route handlers, Vitest 4.

**Spec:** `docs/superpowers/specs/2026-09-03-cron-execution-ledger-design.md`

**Branch:** `claude/plan-cron-ledger`, already cut from `origin/main`.

---

## Background the implementer needs

Three routes are scheduled by `cloudflare/cron-worker/wrangler.jsonc`: `/api/cron/pulse` (`17 4 * * 1`),
`/api/cron/evaluate-alerts` (`47 7 * * 1`), `/api/cron/trial-emails` (`0 9 * * *`). `vercel.json` has
no `crons` key — scheduling moved to Cloudflare on 2026-08-22 and there is no in-repo evidence the
worker was ever deployed.

**Why the database cannot already answer this.** Measured read-only against production on
2026-09-03: 11 accounts, **0 trialing**, 0 with `trial_emails_sent`, 0 `pulse_weekly_summary` rows,
0 `notifications`, 0 `prompt_bank`. Each route writes only when it finds work, and every input is
empty — so all three produce exactly this trace whether they run or not.

**Do not "fix" that by making a route write when idle.** The ledger is the mechanism; the jobs'
behaviour is out of scope.

Two conventions this repo will bite you on:

- **`git add -A` is forbidden here.** Name files explicitly in every commit.
- The Neon driver is tagged-template only. `sql(someString)` throws.

---

## File structure

| File | Responsibility | Action |
|---|---|---|
| `supabase/migrations/039_cron_runs.sql` | The table and its index | Create |
| `lib/cron/recordRun.ts` | Insert start row, close it out | Create |
| `__tests__/api/cron-ledger-wiring.test.ts` | Assert every scheduled route records a run | Create |
| `app/api/cron/pulse/route.ts` | Call the recorder | Modify |
| `app/api/cron/evaluate-alerts/route.ts` | Call the recorder | Modify |
| `app/api/cron/trial-emails/route.ts` | Call the recorder | Modify |

---

### Task 1: Migration `039`

**Files:**
- Create: `supabase/migrations/039_cron_runs.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 039_cron_runs.sql
-- Records every invocation of a scheduled cron route, whether or not it found
-- work to do.
--
-- WHY THIS EXISTS. On 2026-09-03 nothing could distinguish "the Cloudflare
-- worker is deployed and idle" from "it was never deployed". All three
-- scheduled routes write only when they find work, and every input was empty:
-- zero trialing accounts, zero prompt_bank rows, zero pulse rollups, zero
-- notifications. Every table read back zero, equally consistent with both.
--
-- TWO WRITES PER RUN, NOT ONE. The start row is inserted before the job acts;
-- a completion update closes it. A completion-only row would make a crashed or
-- timed-out run indistinguishable from one that never happened -- the exact
-- blind spot this table closes. vercel.json caps these functions at 60s, so a
-- timeout is a real case, not a hypothetical. A row with finished_at IS NULL
-- and an old started_at means "started and died".
--
-- NO RLS. 036 disabled it on 21 tables, and 035 declined to add it for the same
-- reason: aeo_app holds BYPASSRLS deliberately (037), so a policy here would be
-- inert rather than a control. This is operational data with no tenant column.
-- __tests__/migrations/rls-policy-freeze.test.mjs fails if a migration after
-- 035 creates a policy.
--
-- gen_random_uuid() is core in PostgreSQL 13+ and production is 16. Do NOT add
-- `create extension pgcrypto` -- 027 had to be repaired for reaching for it.

create table if not exists cron_runs (
  id          uuid        primary key default gen_random_uuid(),
  route       text        not null,
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  status      text,
  detail      jsonb,
  error       text
);

-- Every query is "most recent runs of route X".
create index if not exists cron_runs_route_started_idx
  on cron_runs (route, started_at desc);

-- 037 sets default privileges in schema public for tables, so this grant should
-- be redundant. It is stated anyway because 038 exists precisely because that
-- assumption held for tables and silently failed for functions, leaving
-- production broken for two weeks. Guarded so the migration still applies on a
-- database where 037 has not run.
do $$
begin
  if to_regrole('aeo_app') is not null then
    grant select, insert, update on cron_runs to aeo_app;
  end if;
end $$;
```

- [ ] **Step 2: Confirm it is the next number and nothing else claims it**

Run: `ls supabase/migrations/ | tail -3`

Expected: `037_…`, `038_…`, `039_cron_runs.sql`. If a `039` already exists, STOP and report.

- [ ] **Step 3: Rehearse on a disposable branch — never on production**

**Production is out of scope and must not be touched.** Do not run `npm run migrate` against
`red-firefly-93523049`; applying it there is a separate, credentialed decision belonging to the
human.

The spec does require verifying the grant, because migration `038` exists precisely because a grant
assumption failed silently and broke production for two weeks. Rehearse on a throwaway Neon branch:

```bash
npx neonctl branches create --project-id <a NON-production project> --org-id org-soft-sunset-25251479 --name cron-ledger-rehearsal
```

Apply `039` there, then verify the grant actually landed:

```sql
select has_table_privilege('aeo_app', 'cron_runs', 'INSERT') as can_insert,
       has_table_privilege('aeo_app', 'cron_runs', 'UPDATE') as can_update;
```

Expected: both `true`. If either is false, `037`'s default privileges did not cover this table and
the explicit grant in the migration is doing real work — say so in your report either way.

**Delete the rehearsal branch afterwards** and confirm it is gone. If you cannot create a branch
(the `neonctl` CLI now prompts interactively for an organization and needs `--org-id`), report
NEEDS_CONTEXT rather than skipping the verification silently or reaching for production.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/039_cron_runs.sql && git commit -F- <<'EOF'
feat(db): add cron_runs, a ledger of scheduled job invocations

Nothing could distinguish a deployed-and-idle cron worker from one that was
never deployed: all three scheduled routes write only when they find work, and
every input was empty.

Two writes per run so a crashed or timed-out run is visible as
finished_at IS NULL, rather than being indistinguishable from never having run.

No RLS, following 035 and 036: aeo_app holds BYPASSRLS, so a policy would be
inert rather than a control.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 2: The recorder module

**Files:**
- Create: `lib/cron/recordRun.ts`

- [ ] **Step 1: Write it**

```ts
import { db } from '@/lib/db'

export type CronRunStatus = 'ok' | 'error'

/**
 * Insert the start row for a cron invocation and return its id.
 *
 * Returns null rather than throwing when the ledger write fails. Observability
 * must not take down a production job -- but note the cost, which is real: a
 * failed ledger write is indistinguishable from a run that never happened. It
 * is mitigated only by the fact that a database outage would fail the job's
 * actual work too.
 */
export async function startCronRun(route: string): Promise<string | null> {
  try {
    const sql = db()
    const rows = await sql`
      insert into cron_runs (route) values (${route}) returning id
    `
    return (rows[0]?.id as string | undefined) ?? null
  } catch (err) {
    console.error(`[cron-ledger] could not record start for ${route}:`, err)
    return null
  }
}

/**
 * Close out a run. No-ops when `id` is null, so a caller whose start row failed
 * does not need to branch.
 */
export async function finishCronRun(
  id: string | null,
  status: CronRunStatus,
  detail?: Record<string, unknown>,
  error?: string,
): Promise<void> {
  if (!id) return
  try {
    const sql = db()
    await sql`
      update cron_runs
         set finished_at = now(),
             status      = ${status},
             detail      = ${detail ? JSON.stringify(detail) : null}::jsonb,
             error       = ${error ?? null}
       where id = ${id}
    `
  } catch (err) {
    console.error(`[cron-ledger] could not record completion for ${id}:`, err)
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck` — expected exit 0.

- [ ] **Step 3: Commit**

```bash
git add lib/cron/recordRun.ts && git commit -F- <<'EOF'
feat(cron): add the cron-run recorder

Kept in its own module rather than inlined so the wiring assertion has
something to assert against.

Both functions swallow their own failures and log: observability must not take
down a production job. The cost is stated in the doc comment rather than
hidden -- a failed ledger write looks like a run that never happened.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 3: The wiring assertion — written BEFORE the routes are wired

**Files:**
- Create: `__tests__/api/cron-ledger-wiring.test.ts`

This is written first, on purpose. It must be watched failing against unwired routes, because a test
that has only ever been seen passing proves nothing about what it would catch.

**It must be behavioural, not a source-text grep.** Asserting that a route file *contains the string*
`startCronRun` would pass on a file with the call commented out, or imported and never invoked. The
failure mode here is "the route does not actually record", so the test must invoke the route.

- [ ] **Step 1: Write the test**

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/cron/recordRun', () => ({
  startCronRun: vi.fn(async () => 'test-run-id'),
  finishCronRun: vi.fn(async () => undefined),
}))

// Every scheduled route touches the database and some send email. Neither is
// under test here -- only whether the route records its invocation.
vi.mock('@/lib/db', () => ({ db: () => new Proxy(() => [], { apply: () => [] }) }))

import { startCronRun } from '@/lib/cron/recordRun'

const SECRET = 'test-cron-secret-at-least-16-chars'

const ROUTES = [
  ['/api/cron/pulse', () => import('@/app/api/cron/pulse/route')],
  ['/api/cron/evaluate-alerts', () => import('@/app/api/cron/evaluate-alerts/route')],
  ['/api/cron/trial-emails', () => import('@/app/api/cron/trial-emails/route')],
] as const

describe('every scheduled cron route records its invocation', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = SECRET
  })

  it.each(ROUTES)('%s calls startCronRun', async (route, load) => {
    const mod = await load()
    const req = new Request(`https://example.test${route}`, {
      headers: { authorization: `Bearer ${SECRET}` },
    })

    // The route's own work may fail against the stubbed database. That is fine:
    // the ledger write happens before the work, and a route that throws must
    // still have recorded that it started.
    await (mod as { GET: (r: Request) => Promise<unknown> }).GET(req).catch(() => undefined)

    expect(startCronRun).toHaveBeenCalledWith(route)
  })
})
```

If the stubbed `db` proxy proves insufficient for a particular route — for example a route that
destructures a specific result shape before the recorder is reached — adjust the stub, **not** the
assertion, and say so in your report. The assertion is the point of the task.

- [ ] **Step 2: Run it and WATCH IT FAIL**

Run: `npx vitest run __tests__/api/cron-ledger-wiring.test.ts`

Expected: **3 failures**, each of the form `expected "startCronRun" to be called with…` — because no
route calls it yet.

**If any case passes here, STOP and report BLOCKED.** Record the verbatim output; this is the
evidence that the guard can fail.

- [ ] **Step 3: Commit the failing test**

Commit it now, before the routes are wired, so the history shows the guard existed and failed first.

```bash
git add __tests__/api/cron-ledger-wiring.test.ts && git commit -F- <<'EOF'
test(cron): assert every scheduled route records its invocation

Committed while failing, before the routes are wired, so the history shows the
guard can fail.

Behavioural rather than a source grep: asserting a file contains "startCronRun"
would pass with the call commented out or imported and never invoked. The
failure mode is "the route does not record", so the test invokes the route.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 4: Wire the three routes

**Files:**
- Modify: `app/api/cron/pulse/route.ts`
- Modify: `app/api/cron/evaluate-alerts/route.ts`
- Modify: `app/api/cron/trial-emails/route.ts`

Each route already gates on `CRON_SECRET` and returns `Response.json(...)`. The pattern is identical
in all three.

- [ ] **Step 1: Apply the pattern**

Record **after** the auth check — an unauthorized probe is not an invocation and should not appear in
the ledger — and **before** the job does any work.

```ts
import { startCronRun, finishCronRun } from '@/lib/cron/recordRun'

// ... inside GET, after the 401/500 auth guards:
const runId = await startCronRun('/api/cron/trial-emails')
try {
  // ... the route's existing body, unchanged ...
  await finishCronRun(runId, 'ok', { sent, failed })
  return Response.json({ sent, failed }, { status: failed > 0 ? 502 : 200 })
} catch (err) {
  await finishCronRun(runId, 'error', undefined, err instanceof Error ? err.message : String(err))
  throw err
}
```

Use the route's own result values in `detail`: `{ sent, failed }` for `trial-emails`, and whatever
each of the other two already returns in its success payload. **Do not invent new counters** and do
not change any status code or response shape.

For `pulse`, note its success payload already includes `configuredClients` — that is the
"nothing was ever set up" signal, and it belongs in `detail`.

- [ ] **Step 2: Run the wiring assertion — expect PASS**

Run: `npx vitest run __tests__/api/cron-ledger-wiring.test.ts`
Expected: 3 passed.

- [ ] **Step 3: Prove it still fails if a route regresses**

Comment out the `startCronRun` call in `trial-emails` only, re-run, confirm **exactly one** case
fails and names that route. Restore, confirm 3 pass, and confirm `git diff` on that route is empty.

- [ ] **Step 4: Full verification**

Run: `npm run lint` — exit 0.
Run: `npm run typecheck` — exit 0.
Run: `npm run test:unit` — exit 0. Record the file and test counts.

- [ ] **Step 5: Commit**

```bash
git add app/api/cron/pulse/route.ts app/api/cron/evaluate-alerts/route.ts app/api/cron/trial-emails/route.ts && git commit -F- <<'EOF'
feat(cron): record every scheduled invocation in cron_runs

Recorded after the auth guards -- an unauthorized probe is not an invocation --
and before any work, so a run that crashes still leaves a start row.

detail carries each route's existing result values; no new counters, no changed
status codes or response shapes. pulse contributes configuredClients, which is
the "nothing was ever set up" signal.

Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
EOF
```

---

### Task 5: Verify and open the pull request

- [ ] **Step 1: Confirm the migration was NOT applied anywhere**

Run: `git status --porcelain` — expected empty.

State explicitly in the PR that `039` is **unapplied**. Applying it is a credentialed human step, and
the ledger produces nothing until it runs.

- [ ] **Step 2: Push and open the PR**

```bash
git push -u origin claude/plan-cron-ledger
```

Write the body to the scratchpad — **not** into the repository — and open the PR with
`gh pr create --base main --head claude/plan-cron-ledger --body-file <scratchpad path>`.

The body must state: the measured production zeros and why each is ambiguous; that the ledger records
invocation rather than work; that `039` is unapplied and by whom it must be applied; and that once
applied, the daily `trial-emails` cron answers the deployment question within 24 hours. End with:

```
🤖 Generated with [Claude Code](https://claude.com/claude-code)
```

- [ ] **Step 3: Verify CI ran against the real HEAD**

```bash
gh run list --limit 5 --json headSha,conclusion,status,workflowName
```

Compare against `git rev-parse HEAD`. **A green run whose headSha is not this branch's HEAD is not
evidence** — that mistake was made earlier in this project.
