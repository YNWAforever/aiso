# Prove the Pulse Rollup Works Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Prove the weekly Pulse rollup actually produces rows, and make "the run did nothing" impossible to mistake for "the run worked".

**Architecture:** The rollup has never written a row in production. This plan does not guess at why — it establishes the cause from evidence, proves the writer works against a real database, and then closes the two gaps that let a dead feature report success for six weeks: a missing static guard tying the writer's `ON CONFLICT` target to a migration that actually creates the matching index, and a cron that returns `200 {done: true, processed: 0}` whether it skipped an empty queue or the whole feature is unconfigured.

**Tech Stack:** TypeScript 5.9, Next.js 16 route handlers, Neon Postgres (`@neondatabase/serverless`), Vitest 4 (unit + integration projects), `neonctl` for throwaway branches, Vercel Cron.

---

## Read this first: the cause is now established, and the docs are wrong

**Verified against the production database on 2026-08-15:**

```
prompt_bank: 0    pulse_metrics: 0    pulse_weekly_summary: 0    ai_citation_log: 0
```

`selectPendingClients` (`lib/pulse/schedule.ts`) will not return a client unless it has an active prompt:

```sql
where exists (
        select 1 from prompt_bank pb
        where pb.client_id = c.id and pb.is_active
      )
```

With zero prompts, **no client is ever selected**, so `app/api/cron/pulse/route.ts:79` returns:

```ts
return NextResponse.json({ done: true, hop, processed: 0 })
```

A **200**. Every Monday since #43 shipped the cron on 2026-08-06, that is what it has returned — a healthy-looking success that is byte-identical to what it would return after legitimately finishing a week's work.

**This corrects a claim that is currently written down in three places.** `docs/alert-evaluation-release.md`, `CLAUDE.md`, and the project memory all state, or imply, that migration `031` being unapplied is why the rollup never produced a row. That is **unproven and probably wrong**. `031` creates the `ON CONFLICT` arbiter `computeWeeklySummary` needs, so the rollup *would* have failed 42P10 had it ever run — but it never ran, because the producer upstream had nothing to scan. Both facts matter; only one of them is the cause. Task 5 fixes the record.

**What this means for scope:** you cannot prove the rollup works using production data, because there is none. Task 3 proves it against a throwaway Neon branch with seeded data. Getting real data flowing needs a human to create a prompt bank for the real client — that is Task 6, and it is not an engineering task.

**Do not** run `npm run migrate`, connect to production for anything but reads, or point any seeding at production. Task 3 uses a throwaway branch and asserts it is not production before writing.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `__tests__/lib/pulse-conflict-arbiter.test.ts` | Static guard: every `ON CONFLICT (...)` target in `lib/` has a matching unique index in `supabase/migrations/`. Catches the `031` class with no database. | Create |
| `app/api/cron/pulse/route.ts` | Distinguish "nothing eligible" from "work done" in the driver's response | Modify |
| `__tests__/api/cron/pulse.test.ts` | Cover the new distinction | Modify |
| `docs/runbooks/verify-pulse-rollup.md` | Executable procedure proving the rollup end to end on a throwaway branch | Create |
| `.github/workflows/pr-gate.yml` | Integration tests do not run in CI, which is why the `031` gap survived | Modify |
| `docs/alert-evaluation-release.md`, `CLAUDE.md` | Replace the unproven `031`-caused-it claim with the verified cause | Modify |

**Commands** (from the repo root):

```bash
npx vitest run __tests__/path/to/file.test.ts
```

```bash
npm run lint
```

Baseline before this plan: **140 files / 1546 tests** pass; lint and typecheck are clean.

---

### Task 1: Static guard — every ON CONFLICT target has a real arbiter

**Files:**
- Test: `__tests__/lib/pulse-conflict-arbiter.test.ts` (create)

This is the guard that would have caught `031` without a database, in CI, on the PR that introduced the writer. Postgres requires the inference columns of `ON CONFLICT (a, b, c)` to match an existing unique index; if none exists the statement raises 42P10 at execution time, which no unit test with a mocked `sql` will ever surface.

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/pulse-conflict-arbiter.test.ts`:

```ts
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

/** Every `on conflict (a, b, c)` target written in application SQL. */
function conflictTargets(source: string): string[][] {
  return [...source.matchAll(/on\s+conflict\s*\(([^)]+)\)/gi)].map(match =>
    match[1].split(',').map(column => column.trim()).filter(Boolean),
  )
}

/** Every unique index the migration set creates, as its column list. */
function uniqueIndexes(): string[][] {
  const dir = join(process.cwd(), 'supabase/migrations')
  const out: string[][] = []

  for (const file of readdirSync(dir).filter(name => name.endsWith('.sql'))) {
    const sql = readFileSync(join(dir, file), 'utf8')
    for (const match of sql.matchAll(
      /create\s+unique\s+index[^(]*\(([^)]+)\)/gi,
    )) {
      out.push(match[1].split(',').map(c => c.trim().replace(/\s+(asc|desc).*$/i, '')).filter(Boolean))
    }
    // Table-level UNIQUE (a, b) constraints are arbiters too.
    for (const match of sql.matchAll(/\bunique\s*\(([^)]+)\)/gi)) {
      out.push(match[1].split(',').map(c => c.trim()).filter(Boolean))
    }
  }

  return out
}

function sameColumns(a: string[], b: string[]): boolean {
  return a.length === b.length && [...a].sort().join() === [...b].sort().join()
}

describe('ON CONFLICT arbiters exist', () => {
  it('the weekly summary writer has a matching unique index', () => {
    // The concrete failure this pins: pulse_weekly_summary carried no uniqueness
    // from 002 until 031, so computeWeeklySummary's ON CONFLICT would raise
    // 42P10 on every execution. A mocked-sql unit test cannot see that, because
    // the arbiter is resolved by Postgres at execution time, not by the driver.
    const summary = readFileSync(join(process.cwd(), 'lib/pulse/summary.ts'), 'utf8')
    const targets = conflictTargets(summary)

    expect(targets.length, 'expected computeWeeklySummary to use ON CONFLICT').toBeGreaterThan(0)

    const indexes = uniqueIndexes()
    for (const target of targets) {
      expect(
        indexes.some(index => sameColumns(index, target)),
        `no unique index matches ON CONFLICT (${target.join(', ')})`,
      ).toBe(true)
    }
  })

  it('every ON CONFLICT under lib/ has a matching unique index', () => {
    const libDir = join(process.cwd(), 'lib')
    const indexes = uniqueIndexes()
    const files: string[] = []

    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (entry.name.endsWith('.ts')) files.push(path)
      }
    }
    walk(libDir)

    for (const file of files) {
      for (const target of conflictTargets(readFileSync(file, 'utf8'))) {
        expect(
          indexes.some(index => sameColumns(index, target)),
          `${file}: no unique index matches ON CONFLICT (${target.join(', ')})`,
        ).toBe(true)
      }
    }
  })
})
```

- [ ] **Step 2: Run the test**

Run: `npx vitest run __tests__/lib/pulse-conflict-arbiter.test.ts`

Expected: **PASS, 2 tests** — because migration `031` now exists and creates `pulse_weekly_summary_client_week_platform_unique (client_id, scan_week, platform)`, matching the writer.

This is the one task in the plan where a passing test on first run is the correct outcome: the bug it guards is already fixed, and the test exists to stop it returning. Prove it can fail in Step 3 rather than trusting it.

- [ ] **Step 3: Prove the guard actually bites**

Temporarily rename the index in the migration so the arbiter no longer matches:

```bash
sed -i '' 's/pulse_weekly_summary_client_week_platform_unique/tmp_broken_idx_name/' supabase/migrations/031_pulse_weekly_summary_unique.sql
sed -i '' 's/(client_id, scan_week, platform)/(client_id, scan_week)/' supabase/migrations/031_pulse_weekly_summary_unique.sql
npx vitest run __tests__/lib/pulse-conflict-arbiter.test.ts
```

Expected: **FAIL** with `no unique index matches ON CONFLICT (client_id, scan_week, platform)`.

Then restore it — do not hand-edit it back:

```bash
git checkout supabase/migrations/031_pulse_weekly_summary_unique.sql
npx vitest run __tests__/lib/pulse-conflict-arbiter.test.ts
```

Expected: PASS again, and `git status --short` shows no change to that migration.

- [ ] **Step 4: Commit**

```bash
git add __tests__/lib/pulse-conflict-arbiter.test.ts
git commit -m "test(pulse): pin every ON CONFLICT target to a real unique index"
```

---

### Task 2: Make a do-nothing run distinguishable from a successful one

**Files:**
- Modify: `app/api/cron/pulse/route.ts`
- Test: `__tests__/api/cron/pulse.test.ts` (**create** — it does not exist; `__tests__/api/cron/` currently holds only `evaluate-alerts.test.ts`, so the driver has no route-level test at all today)

`app/api/cron/pulse/route.ts:79` currently returns `NextResponse.json({ done: true, hop, processed: 0 })` when `selectPendingClients` comes back empty. That response is identical whether the week's work is genuinely finished or no client has ever been eligible. For six weeks it has meant the latter while reading as the former.

- [ ] **Step 1: Read the current handler**

Read `app/api/cron/pulse/route.ts` around the `selectPendingClients` call and the empty-queue return. Confirm the exact current shape before changing it, and report what you find.

- [ ] **Step 2: Write the failing test**

Create `__tests__/api/cron/pulse.test.ts`. The mock shape below mirrors its sibling `__tests__/api/cron/evaluate-alerts.test.ts` — `vi.hoisted` handles for each module the route imports, a `vi.resetModules()` re-import helper, and per-describe `CRON_SECRET` save/restore:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const h = vi.hoisted(() => ({
  db: vi.fn(),
  selectPendingClients: vi.fn(),
  appOrigin: vi.fn(),
}))

vi.mock('@/lib/db', () => ({ db: h.db }))
vi.mock('@/lib/pulse/schedule', () => ({ selectPendingClients: h.selectPendingClients }))
vi.mock('@/lib/app-origin', () => ({ appOrigin: h.appOrigin }))

async function importRoute() {
  vi.resetModules()
  return import('@/app/api/cron/pulse/route')
}

function cronRequest(bearer?: string) {
  return new Request('https://app.example/api/cron/pulse', {
    headers: bearer ? { authorization: `Bearer ${bearer}` } : {},
  })
}

describe('GET /api/cron/pulse', () => {
  const originalCronSecret = process.env.CRON_SECRET

  beforeEach(() => {
    vi.clearAllMocks()
    process.env.CRON_SECRET = 'test-cron-secret'
    h.db.mockReturnValue('sql')
    h.appOrigin.mockReturnValue('https://app.example')
  })

  afterEach(() => {
    if (originalCronSecret === undefined) delete process.env.CRON_SECRET
    else process.env.CRON_SECRET = originalCronSecret
  })

  it('rejects a request without the Bearer secret', async () => {
    const { GET } = await importRoute()

    const response = await GET(cronRequest())

    expect(response.status).toBe(401)
    expect(h.selectPendingClients).not.toHaveBeenCalled()
  })

  it('says why it did nothing when no client is eligible', async () => {
    // The silent-green failure this closes: with an empty prompt_bank no client
    // is ever selected, and the driver returned {done:true, processed:0} -- the
    // same body a genuinely finished week produces. Six weekly runs reported
    // success while the feature had never scanned anything.
    h.selectPendingClients.mockResolvedValue([])
    const { GET } = await importRoute()

    const response = await GET(cronRequest('test-cron-secret'))
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ done: true, processed: 0, eligibleClients: 0 })
  })
})
```

The route takes a `NextRequest`, so if TypeScript objects to passing a plain `Request`, cast at the call site (`GET(cronRequest('test-cron-secret') as never)`) rather than loosening the route's signature. Tests are excluded from `npm run typecheck` in this repo, so this will not surface there either way.

- [ ] **Step 3: Run the test, expect FAIL**

Run: `npx vitest run __tests__/api/cron/pulse.test.ts`

Expected: FAIL — the returned body has no `eligibleClients` key, so `toMatchObject` reports it missing.

- [ ] **Step 4: Change the handler**

In `app/api/cron/pulse/route.ts`, replace the empty-queue return:

```ts
    return NextResponse.json({ done: true, hop, processed: 0 })
```

with:

```ts
    // `processed: 0` alone cannot distinguish "the week is finished" from "no
    // client was ever eligible" -- selectPendingClients requires an active
    // prompt_bank row, so an unconfigured workspace yields the same body as a
    // completed run. eligibleClients makes the difference visible in the logs.
    return NextResponse.json({ done: true, hop, processed: 0, eligibleClients: 0 })
```

- [ ] **Step 5: Run the test, expect PASS**

Run: `npx vitest run __tests__/api/cron/pulse.test.ts`

Expected: PASS, every test in the file.

- [ ] **Step 6: Commit**

```bash
git add app/api/cron/pulse/route.ts __tests__/api/cron/pulse.test.ts
git commit -m "feat(pulse): report why a driver run processed nothing"
```

---

### Task 3: Prove the rollup end to end on a throwaway branch

**Files:**
- Create: `docs/runbooks/verify-pulse-rollup.md`

Integration coverage for `computeWeeklySummary` already exists at `__tests__/integration/pulse-summary.test.ts`. It has never been the problem — the problem is that it does not run without `neonctl`, and it does not run in CI at all (Task 4). This task runs it deliberately, against a branch that has `031`, and writes down the procedure.

**Safety, non-negotiable:** the harness at `__tests__/integration/setup.ts` executes `drop schema public cascade`. It carries its own branch assertion, and you must not weaken or bypass it. Confirm the target is a throwaway branch before running anything.

- [ ] **Step 1: Create a throwaway branch, without leaking its DSN**

```bash
scripts/neon branches create --project-id red-firefly-93523049 --name verify-pulse-rollup --parent production
```

Use `scripts/neon`, never bare `neonctl` — `branches create` prints a connection URI including the password, and branch roles are inherited from the parent, so bare `neonctl` discloses the production credential. The wrapper redacts it.

- [ ] **Step 2: Derive the branch DSN and assert it is not production**

Do **not** use `neonctl connection-string --branch-id` — it returns the *parent's* endpoint, which means a DSN you believe is a throwaway actually points at production. This is verified behaviour, not a theoretical risk.

Take the branch's own endpoint host from the Step 1 output and derive the DSN by substituting only the hostname:

```bash
BRANCH_HOST="<the ep-… host from step 1>"
export TEST_DATABASE_URL="$(node --env-file='/Users/willylai/Documents/Claude/Projects/Fimmick AEOGEO/.env.local' -e '
const u = new URL(process.env.DATABASE_URL);
u.hostname = process.argv[1];
process.stdout.write(u.toString());' "$BRANCH_HOST")"

node -e "
const u = new URL(process.env.TEST_DATABASE_URL);
if (u.hostname.includes('ep-dawn-glade-aoio1qs6')) { console.error('ABORT: production endpoint'); process.exit(1) }
console.log('target:', u.hostname, '(not production)');"
```

Expected: prints the branch host and `(not production)`. **If it prints ABORT, stop.**

- [ ] **Step 3: Run the integration suite against it**

```bash
REQUIRE_INTEGRATION_TESTS=1 npm run test:integration
```

Expected: PASS. `REQUIRE_INTEGRATION_TESTS=1` turns a skip into a failure, so a green result here means the tests actually executed — a skip is not a pass.

Record the observed file and test counts.

- [ ] **Step 4: Confirm the property that `031` exists to protect**

`031`'s `NULLS NOT DISTINCT` is what stops two aggregate (`platform IS NULL`) rows coexisting for one client-week. Alerting reads "the latest two aggregate weeks" and computes a week-over-week delta; handed two copies of the same week it computes 0% and never fires.

Check whether `__tests__/integration/pulse-summary.test.ts` already asserts that running the rollup twice leaves exactly one aggregate row. Read it and report. If it does, quote the assertion. If it does not, add this test to that file, following the file's existing setup helpers:

```ts
  it('refreshes the aggregate row rather than duplicating it', async () => {
    // 031's NULLS NOT DISTINCT is the load-bearing part: under a plain unique
    // index NULLs compare distinct, so two `platform is null` rows for the same
    // client-week coexist, and the alert evaluator's week-over-week delta then
    // compares a week against itself and reports 0%.
    await computeWeeklySummary(sql, { clientId: CLIENT, scanWeek: MONDAY })
    await computeWeeklySummary(sql, { clientId: CLIENT, scanWeek: MONDAY })

    const rows = await sql`
      select count(*) as n from pulse_weekly_summary
      where client_id = ${CLIENT}::uuid
        and scan_week = ${MONDAY}::date
        and platform is null`

    expect(Number(rows[0].n)).toBe(1)
  })
```

- [ ] **Step 5: Delete the throwaway branch**

```bash
scripts/neon branches delete <branch-id> --project-id red-firefly-93523049
```

Then confirm the project is back to its three original branches (`production`, `preview-alert-evaluation`, `preview-pro-client-reports`):

```bash
scripts/neon branches list --project-id red-firefly-93523049
```

- [ ] **Step 6: Write the runbook**

Create `docs/runbooks/verify-pulse-rollup.md` recording exactly the procedure you just executed — steps 1 through 5, the two `neonctl` hazards (the URI-printing on create, the parent-endpoint on `connection-string --branch-id`), the not-production assertion, the `REQUIRE_INTEGRATION_TESTS=1` requirement, and the observed result including counts. Write what happened, not what should happen.

- [ ] **Step 7: Commit**

```bash
git add docs/runbooks/verify-pulse-rollup.md __tests__/integration/pulse-summary.test.ts
git commit -m "docs(pulse): record the verified rollup procedure"
```

If you did not need to change the integration test in Step 4, drop it from the `git add`.

---

### Task 4: Run integration tests in CI

**Files:**
- Modify: `.github/workflows/pr-gate.yml`
- Test: `__tests__/ci/pr-gate-workflow.test.ts`

`pr-gate.yml` has four jobs — `static`, `unit-contract`, `e2e-accessibility`, `build` — and **none of them runs the integration project**. That is the structural reason the `031` gap survived to production: the suite that exercises real SQL against a real Postgres never ran on any PR.

- [ ] **Step 1: Read the workflow and its existing test**

Read `.github/workflows/pr-gate.yml` and `__tests__/ci/pr-gate-workflow.test.ts`. Report the exact job names, how each job is asserted by the test, and how the final `pr-gate` job aggregates via `needs`.

- [ ] **Step 2: Decide and report the approach before changing anything**

Integration tests need a live Neon branch, which needs a `NEON_API_KEY` secret in the repository. **Report which of these applies before proceeding:**

- **(a)** The secret exists, or the human can add it → add an `integration` job that provisions a branch and runs `REQUIRE_INTEGRATION_TESTS=1 npm run test:integration`, and add it to the `pr-gate` job's `needs`.
- **(b)** The secret does not exist and cannot be added now → do **not** add a job that will fail on every PR. Instead add an assertion to `__tests__/ci/pr-gate-workflow.test.ts` recording that integration is deliberately not in CI and naming what compensates for it (Task 1's static guard plus the Task 3 runbook), so the gap is documented rather than silently forgotten.

Ask before implementing whichever branch you land on — this is a judgement about repository secrets, not a code detail.

- [ ] **Step 3: Implement the approach you reported, then run its test**

Run: `npx vitest run __tests__/ci/pr-gate-workflow.test.ts`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/pr-gate.yml __tests__/ci/pr-gate-workflow.test.ts
git commit -m "ci(pulse): close the integration-coverage gap"
```

---

### Task 5: Correct the record

**Files:**
- Modify: `docs/alert-evaluation-release.md`
- Modify: `CLAUDE.md`

Three places assert or imply that `031` being unapplied is why the rollup never produced a row. The evidence says otherwise: the producer never ran, because `prompt_bank` is empty. Both facts are true; only one is the cause, and stating the wrong one sends the next person to the wrong place.

- [ ] **Step 1: Fix the release doc**

In `docs/alert-evaluation-release.md`, find the known-limitation bullet stating that without `031` the rollup 42P10s and no aggregate row is produced. Keep the mechanism — it is accurate and worth knowing — but correct the causal claim by replacing that bullet's final sentence with:

```markdown
  Verified on 2026-08-15: this is a real hazard but it is **not** why production
  has no rollup rows. `prompt_bank` is empty, `selectPendingClients` requires an
  active prompt, so no client is ever selected and the producer never reaches the
  rollup at all. `031` is now applied; the rollup is unproven in production rather
  than known-broken, and stays that way until a workspace has prompts.
```

- [ ] **Step 2: Fix CLAUDE.md**

In `CLAUDE.md`, find the line stating the Pulse rollup has never written a row and attributing it to `031`. Replace the attribution with:

```markdown
  **verified 2026-08-15: `prompt_bank` is empty in production, so
  `selectPendingClients` returns nothing and the producer never runs.** The driver
  answers `200 {done: true, processed: 0}` every Monday, which is why six weeks of
  dead runs looked healthy. `031` (the `ON CONFLICT` arbiter the rollup needs) was
  also unapplied until 2026-08-15 and would have broken the write had it been
  reached — a second fault, not the cause.
```

- [ ] **Step 3: Verify no other file still asserts the wrong cause**

Run:

```bash
grep -rn "031" --include=*.md . | grep -v node_modules | grep -iv "migration list" | head -20
```

Report every hit that attributes the empty rollup to `031`, and fix each the same way. Do not edit files under `docs/superpowers/plans/` — those are historical records of what was believed at the time, and rewriting them destroys the audit trail.

- [ ] **Step 4: Commit**

```bash
git add docs/alert-evaluation-release.md CLAUDE.md
git commit -m "docs(pulse): correct why the rollup has never produced a row"
```

---

### Task 6: Give the feature something to do (HUMAN — product decision)

**Files:** none.

> **Agents: do not perform this task.** It requires deciding which questions a real customer's brand should be monitored for. That is product judgement about a live workspace, not engineering.

The Pulse pipeline is now proven and guarded, but it will keep returning `{done: true, processed: 0, eligibleClients: 0}` every Monday until a client has an active prompt bank. Nothing in this plan changes that, and nothing should — inventing monitoring questions for a real brand is not a safe thing to automate.

- [ ] **Step 1: Human seeds a prompt bank**

For at least one client on a plan that grants platforms, add active `prompt_bank` rows via the editor at `/{lang}/dashboard/{clientId}/prompts`. `lib/pulse/limits.ts` caps a bank at `MAX_PROMPTS`, and the writer enforces the same number the scanner reads.

- [ ] **Step 2: Watch the next Monday**

The driver runs at 04:17 UTC. Confirm the response now reports a non-zero `eligibleClients` and that `pulse_weekly_summary` gains a `platform IS NULL` aggregate row for that week.

- [ ] **Step 3: Note the alerting dependency**

Week-over-week alerts need **two** consecutive aggregate weeks. `sov_threshold` and `sov_recovery` can fire from one; `sov_wow_drop` stays silent until the second Monday. That is correct behaviour, not a fault — expect it rather than debugging it.

---

## What this plan deliberately does not do

- **It does not seed production data.** Task 3 proves the rollup on a throwaway branch precisely so that nothing is written to a real workspace to make a test pass.
- **It does not fix the two known alert-evaluator limitations** (the serial delivery loop truncating around 100–150 fired alerts, and the missing rollup-staleness guard). Both are recorded in `docs/alert-evaluation-release.md`. They are real, but they only bite once alerts actually fire, which is downstream of this plan.
- **It does not change `MAX_PROMPTS` or the cron cadence.** Nothing observed here suggests either is wrong; they are untested at real volume simply because no volume exists yet.
