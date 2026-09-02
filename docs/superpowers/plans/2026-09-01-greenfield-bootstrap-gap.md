# Greenfield Bootstrap Gap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make a database bootstrapped from `supabase/baseline/000_baseline_2026-08-31.sql` a lineage that `npm run migrate` leaves alone, so a greenfield project can be brought to head.

**Architecture:** The baseline records the 36 migrations it subsumes in `schema_migrations`, exactly as the legacy path records them. `scripts/migrate.ts` is not changed at all. A unit test pins the recorded list to a prefix of `supabase/migrations/`, and `scripts/schema-equivalence.mjs` gains a step that runs the real runner against the baselined branch and requires it to find nothing pending.

**Tech Stack:** PostgreSQL (Neon), Node 24, Vitest 4, `@neondatabase/serverless`.

**Spec:** `docs/superpowers/specs/2026-09-01-greenfield-bootstrap-gap-design.md`

---

## Read this first: two documented decisions this plan reverses

Do not treat these as oversights to "fix quietly". Both were deliberate, both are being
changed deliberately, and Task 4 updates them.

**1. The baseline's own comment argues against this change.** Lines 3160–3165 of
`supabase/baseline/000_baseline_2026-08-31.sql` currently say:

> Note what is NOT recorded: 001-037 individually. They are not "applied" here and claiming
> they were would be a lie the runner would then act on.

That framing is wrong, and the reason it is wrong is the whole basis of this plan. The ledger's
meaning is **"the objects of this migration are present, do not apply it again"**, not "this
file was literally executed here". That is precisely what `npm run migrate -- --baseline`
writes for a database whose objects were created by hand — the mode `migrate.ts:7` documents
as recording "existing migrations as applied without running them", and the mode by which
production itself was baselined. `unappliedBaselineClaims` (`scripts/migrate.ts:112`) enforces
that meaning by refusing to record a migration whose objects are absent.

**2. ADR-007 specifies a single ledger row.** `docs/adr/ADR-007-greenfield-neon-bootstrap.md:62`
says `schema_migrations` "starts with a single baseline record ... plus its checksum". This
plan makes it start with 37 rows.

The ADR's *intent* survives intact and is in fact unachievable without this change: line 42
requires "exactly one incremental migration line after the baseline (`038+`)", which cannot
happen while the runner replays `001`–`038` first. Task 4 amends the ADR to say so rather than
leaving the contradiction in place.

---

## File Structure

| File | Change | Responsibility |
|---|---|---|
| `__tests__/db/baseline-ledger.test.ts` | Modify | Pins the ledger contract: chain list is a prefix of `supabase/migrations/`, chain rows carry no checksum |
| `supabase/baseline/000_baseline_2026-08-31.sql` | Modify (~line 3160–3209) | Records the subsumed chain; comment block rewritten with the corrected reasoning |
| `scripts/schema-equivalence.mjs` | Modify (~line 84, 104–113) | Bootstrap proof: runner finds nothing pending on the baselined branch |
| `docs/adr/ADR-007-greenfield-neon-bootstrap.md` | Modify | Amendment recording the reversal and why |

`scripts/migrate.ts` is **not** modified. If a task tempts you to change it, stop — that is
approach B, which the spec rejected.

---

### Task 1: Pin the ledger contract

The existing test asserts the opposite of what we want, so it is replaced rather than extended.
This is the RED step: the new assertions fail until Task 2 lands.

**Files:**
- Test: `__tests__/db/baseline-ledger.test.ts`

- [ ] **Step 1: Replace the test file**

Replace the entire contents of `__tests__/db/baseline-ledger.test.ts` with:

```ts
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const BASELINE = readFileSync(
  join(process.cwd(), 'supabase', 'baseline', '000_baseline_2026-08-31.sql'),
  'utf8',
)
const MIGRATE = readFileSync(join(process.cwd(), 'scripts', 'migrate.ts'), 'utf8')

const MIGRATIONS = readdirSync(join(process.cwd(), 'supabase', 'migrations'))
  .filter((f) => f.endsWith('.sql'))
  .sort()

/**
 * The chain insert, matched by its column list.
 *
 * The lineage row names `(filename, checksum)`; the chain rows name `(filename)`
 * alone, so the closing paren straight after `filename` distinguishes them
 * without depending on which appears first in the file.
 */
function chainInsertStatement(sql: string): string | null {
  const match = /insert into schema_migrations \(filename\)\s*values[\s\S]*?;/i.exec(sql)
  return match ? match[0] : null
}

function listedChainMigrations(sql: string): string[] {
  const statement = chainInsertStatement(sql)
  if (!statement) return []
  return [...statement.matchAll(/'([^']+\.sql)'/g)].map((m) => m[1])
}

describe('baseline ledger', () => {
  it('creates the schema_migrations ledger with a checksum column', () => {
    expect(BASELINE).toMatch(/create table if not exists schema_migrations/i)
    expect(BASELINE).toMatch(/checksum\s+text/i)
  })

  it('keeps the column shape migrate.ts already relies on', () => {
    expect(BASELINE).toMatch(/filename\s+text\s+primary key/i)
    expect(BASELINE).toMatch(/applied_at\s+timestamptz/i)
  })

  it('keeps migrate.ts and the baseline declaring the same ledger columns', () => {
    // Both paths must create an identical schema_migrations or the equivalence
    // proof breaks on the columns class.
    expect(MIGRATE).toMatch(/checksum\s+text/i)
  })

  it('records its own lineage row with a checksum', () => {
    expect(BASELINE).toMatch(/insert into schema_migrations \(filename, checksum\)/i)
    expect(BASELINE).toContain("'000_baseline_2026-08-31.sql'")
  })

  // Without these rows planMigrations() reports every chain file as pending on a
  // baselined database and 001 aborts on an already-existing table, so a
  // greenfield project cannot be brought to head at all.
  it('records the chain it subsumes', () => {
    expect(listedChainMigrations(BASELINE).length).toBeGreaterThan(0)
  })

  // A PREFIX, not every file. Migration 039 and later must apply to both
  // lineages; listing one here would record it as applied without ever creating
  // its objects -- the stranded-objects hazard unappliedBaselineClaims exists to
  // prevent. Prefix of the SORTED FILENAMES, not of the numbering: 005 and 006
  // have never existed, so a numeric-contiguity check would fail on a legitimate
  // pre-existing gap.
  it('records a contiguous prefix of supabase/migrations/', () => {
    const listed = listedChainMigrations(BASELINE)
    expect(listed).toEqual(MIGRATIONS.slice(0, listed.length))
  })

  // `checksum` means "these bytes produced this lineage", and only the baseline
  // file's bytes were hashed. Omitting it also makes these rows byte-identical
  // in shape to what migrate.ts writes on the legacy path, which names only
  // `filename`.
  it('records chain rows without a checksum', () => {
    expect(chainInsertStatement(BASELINE)).not.toMatch(/checksum/i)
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/db/baseline-ledger.test.ts`

Expected: **2 failed**, 5 passed.
- `records the chain it subsumes` — `expected +0 to be greater than +0`
- `records chain rows without a checksum` — fails because `chainInsertStatement` returns
  `null` and `toMatch` requires a string, so Vitest reports a matcher error on the received
  value rather than a normal assertion diff. Either way it is red, and it goes green in
  Task 2 once the statement exists.

If `records a contiguous prefix of supabase/migrations/` also appears to pass, that is
correct and not a bug: an empty list is trivially a prefix. It becomes load-bearing in Task 2.

- [ ] **Step 3: Commit**

```bash
git add __tests__/db/baseline-ledger.test.ts
git commit -m "test(db): pin the baseline ledger to the chain it subsumes"
```

---

### Task 2: Record the subsumed chain in the baseline

**Files:**
- Modify: `supabase/baseline/000_baseline_2026-08-31.sql:3160-3209`

- [ ] **Step 1: Rewrite the comment block**

In `supabase/baseline/000_baseline_2026-08-31.sql`, replace the block that currently begins
`-- Note what is NOT recorded: 001-037 individually.` (line 3160) down to and including the
line `-- that was recorded from different bytes.` (line 3205) — everything between those two
lines inclusive, stopping immediately above the `-- =====...` rule at line 3206 — with:

```
-- Also recorded: the 36 chain migrations this file subsumes, 001-004 and
-- 007-038. That is NOT a claim that those files executed here. The ledger's
-- meaning is "the objects of this migration are present, do not apply it
-- again" -- exactly the claim `npm run migrate -- --baseline` writes for a
-- database whose objects were created by hand, which is how production itself
-- was baselined. `npm run schema:equivalence` is what earns the claim: it
-- proves this file produces what replaying the chain produces.
--
-- An earlier version of this comment called recording them "a lie the runner
-- would then act on". That was wrong, and it left a real defect in place.
-- planMigrations() is `files.filter(f => !applied.has(f))` over the contents of
-- supabase/migrations/, so a lineage naming only this file reports all 36 as
-- pending and starts applying them against a schema that already has every one
-- of their objects. 001 aborts on the first `create table` of a table that
-- exists -- loud, and its transaction rolls back rather than corrupting
-- anything, but a failure, not a no-op. A greenfield database could not be
-- brought to head at all.
--
-- The chain rows carry no checksum, deliberately: `checksum` means "these bytes
-- produced this lineage", and only this file's bytes were hashed. It also makes
-- them byte-identical in shape to what scripts/migrate.ts writes on the legacy
-- path, which names only `filename`.
--
-- Migration 039 and later are listed nowhere here and must not be: they apply
-- to both lineages normally. __tests__/db/baseline-ledger.test.ts pins the
-- recorded list to a PREFIX of supabase/migrations/ so that stays true, and
-- scripts/schema-equivalence.mjs runs `migrate --dry-run` against the baselined
-- branch and requires "Nothing to apply", so the replay defect cannot return
-- unnoticed.
--
-- The lineage row is last because everything above it must have succeeded for
-- the claim to be true. Postgres does not wrap a multi-statement string in an
-- implicit transaction over the simple query protocol, so an abort partway
-- through leaves earlier statements committed -- but that row, being last, is
-- not among them. A half-built database therefore has no lineage row, which is
-- the honest outcome: `npm run migrate` refuses it rather than continuing from
-- 039 over a schema that is missing tables.
--
-- :'baseline_checksum' is substituted by scripts/schema-equivalence.mjs, which
-- hashes this file's raw bytes with SHA-256 before executing it. .gitattributes
-- pins supabase/baseline/*.sql to `eol=lf`, so the digest is the same on Windows
-- and on CI for byte-identical SQL. Editing this file changes the digest, which
-- is the point: the row records what was actually run, so a lineage claiming
-- this baseline can be checked against the file that supposedly produced it.
-- Anything applying this file by another route must perform the same
-- substitution -- psql does it natively with
-- `-v baseline_checksum="$(sha256sum ...)"`.
--
-- `on conflict do nothing` on both inserts because a row is a claim, not a
-- counter: re-running the file on a database that already has the lineage must
-- not rewrite a digest that was recorded from different bytes.
```

- [ ] **Step 2: Add the chain insert**

Immediately **above** the existing `insert into schema_migrations (filename, checksum)`
statement (so the lineage row stays last, as the comment says), insert:

```sql
insert into schema_migrations (filename)
values
  ('001_phase1.sql'),
  ('002_phase2.sql'),
  ('003_phase3a_accounts.sql'),
  ('004_phase3a_clients_fk.sql'),
  ('007_fix_handle_new_user_with_account.sql'),
  ('008_scans_account_id.sql'),
  ('009_clients_domain.sql'),
  ('010_phase3b.sql'),
  ('011_phase3b_hardening.sql'),
  ('012_aiso_v3.sql'),
  ('013_agent_dashboard.sql'),
  ('014_subscription_tiers.sql'),
  ('015_scan_lead_email.sql'),
  ('016_trial_columns.sql'),
  ('017_fix_handle_new_user_plan.sql'),
  ('018_clients_region.sql'),
  ('019_clients_description.sql'),
  ('020_scans_public_select.sql'),
  ('021_local_trust_roi.sql'),
  ('022_profiles_neon_auth_fk.sql'),
  ('023_public_scan_rate_limits.sql'),
  ('024_stripe_lifecycle_integrity.sql'),
  ('025_authenticated_scan_quotas.sql'),
  ('026_effective_brand_limit.sql'),
  ('027_client_report_snapshots.sql'),
  ('028_account_plan_overrides.sql'),
  ('029_scans_client_id.sql'),
  ('030_accounts_plan_default_basic.sql'),
  ('031_pulse_weekly_summary_unique.sql'),
  ('032_pulse_metrics_indexes.sql'),
  ('033_alert_evaluation_hardening.sql'),
  ('034_alert_evaluation_snapshot_refinement.sql'),
  ('035_alert_email_delivery_ledger.sql'),
  ('036_drop_dead_rls_policies.sql'),
  ('037_least_privilege_app_role.sql'),
  ('038_app_role_function_execute.sql')
on conflict (filename) do nothing;
```

Do not reformat, reorder, or "tidy" this list — the test compares it element-for-element
against `readdirSync` output in sorted order.

- [ ] **Step 3: Run the tests to verify they pass**

Run: `npx vitest run __tests__/db/baseline-ledger.test.ts`

Expected: **7 passed**.

If `records a contiguous prefix of supabase/migrations/` fails, the list does not match the
directory. Read the failure diff — it names the exact element that differs. Do not "fix" it by
loosening the assertion.

- [ ] **Step 4: Commit**

```bash
git add supabase/baseline/000_baseline_2026-08-31.sql
git commit -m "fix(baseline): record the migration chain the baseline subsumes"
```

---

### Task 3: Bootstrap proof in the equivalence runner

**Files:**
- Modify: `scripts/schema-equivalence.mjs:84`, `scripts/schema-equivalence.mjs:104-113`

`execFileSync` (line 13) and `redactSecrets` (line 28) are already imported. Do not add imports.

- [ ] **Step 1: Add the helper**

Add this function directly above `async function main()` (which begins at line 84):

```js
/**
 * `migrate --dry-run` against a branch, as text.
 *
 * Captures stdout rather than inheriting it so the caller can assert on the
 * result. A non-zero exit makes execFileSync throw with the output on the error
 * object, which is a legitimate outcome to report rather than crash on -- but
 * the driver embeds the full connection URL, password included, in some error
 * fields, so everything on that path goes through redactSecrets.
 */
function runMigrateDryRun(connectionUri) {
  try {
    return execFileSync('node', ['scripts/migrate.ts', '--dry-run'], {
      env: { ...process.env, MIGRATE_DATABASE_URL: connectionUri },
      encoding: 'utf8',
    })
  } catch (err) {
    const stdout = typeof err?.stdout === 'string' ? err.stdout : ''
    const stderr = typeof err?.stderr === 'string' ? err.stderr : ''
    return redactSecrets(`${stdout}${stderr}` || String(err?.message ?? err))
  }
}
```

- [ ] **Step 2: Add the proof**

In `scripts/schema-equivalence.mjs`, replace these lines (currently 104–113):

```js
    const baseline = await withBranchClient(branch, introspectSchema)

    const diff = diffSchemas(legacy, baseline)
    console.log('\nSchema equivalence (legacy 001-037 vs baseline):')
    for (const [className, classDiff] of Object.entries(diff.classes)) {
      reportClass(className, classDiff)
    }

    console.log(diff.equivalent ? '\nEQUIVALENT' : '\nDIVERGENT')
    process.exitCode = diff.equivalent ? 0 : 1
```

with:

```js
    const baseline = await withBranchClient(branch, introspectSchema)

    // Bootstrap proof. Equivalence alone does not make the baseline usable: the
    // runner reads supabase/migrations/ and, without the chain rows, reports
    // every one of them pending on a baselined database, so 001 aborts on an
    // already-existing table and a greenfield project cannot reach head.
    // Runs AFTER introspection so the compared snapshot is unaffected either
    // way, and --dry-run so it cannot mutate the branch. When it fails it names
    // exactly which migrations it would have replayed.
    const bootstrap = runMigrateDryRun(branch.connectionUri)
    const bootstrapOk = bootstrap.includes('Nothing to apply')
    console.log(`\nBootstrap proof: ${bootstrapOk ? 'ok — runner finds nothing pending' : 'FAILED'}`)
    if (!bootstrapOk) console.log(bootstrap.trim())

    const diff = diffSchemas(legacy, baseline)
    console.log('\nSchema equivalence (legacy 001-038 vs baseline):')
    for (const [className, classDiff] of Object.entries(diff.classes)) {
      reportClass(className, classDiff)
    }

    console.log(diff.equivalent ? '\nEQUIVALENT' : '\nDIVERGENT')
    process.exitCode = diff.equivalent && bootstrapOk ? 0 : 1
```

- [ ] **Step 3: Run the full equivalence proof**

Run: `npm run schema:equivalence`

Expected (takes ~2–3 minutes; provisions and deletes a real Neon branch):

```
Bootstrap proof: ok — runner finds nothing pending

Schema equivalence (legacy 001-038 vs baseline):
  columns      ok
  constraints  ok
  indexes      ok
  triggers     ok
  functions    ok
  grants       ok
  rls          ok
  extensions   ok

EQUIVALENT
```

Exit code 0. Confirm the branch was deleted — the last line names it.

- [ ] **Step 4: Prove the new guard is load-bearing**

A guard nobody has watched fail is not yet known to work. Temporarily neutralise the chain
insert and confirm the proof catches it.

Wrap the whole chain-insert statement added in Task 2 in a `/*` … `*/` block comment.

Run: `npm run schema:equivalence`

Expected: the run reports

```
Bootstrap proof: FAILED
Would apply 36 migration(s):
  001_phase1.sql
  ...
```

and exits **1**, even though the schema classes still report `ok` and `EQUIVALENT`. That
combination is the point: the schemas match, and the database is still unbootstrappable.

Now **restore the statement** (remove the `/*` and `*/`) and re-run:

Run: `npm run schema:equivalence`

Expected: `Bootstrap proof: ok`, `EQUIVALENT`, exit 0.

Confirm nothing is left commented out:

```bash
git diff --stat supabase/baseline/000_baseline_2026-08-31.sql
```

Expected: no output (the file matches the Task 2 commit).

- [ ] **Step 5: Commit**

```bash
git add scripts/schema-equivalence.mjs
git commit -m "feat(baseline): prove a baselined database needs no chain replay"
```

---

### Task 4: Amend the two documents this change reverses

**Files:**
- Modify: `docs/adr/ADR-007-greenfield-neon-bootstrap.md:62`

- [ ] **Step 1: Amend the ledger clause**

In `docs/adr/ADR-007-greenfield-neon-bootstrap.md`, find the bullet beginning
``- `schema_migrations` in the new project starts with a single baseline record`` (line 62)
and replace that bullet — through the end of its `--baseline` sentence at line 65 — with:

```markdown
- `schema_migrations` in the new project starts with the baseline record (e.g.
  `000_baseline_2026-08-30.sql`) **plus one row for each migration the baseline subsumes**.
  **Amended 2026-09-01**: this clause originally said "a single baseline record". A single
  record leaves the database unbootstrappable — `planMigrations` reads `supabase/migrations/`,
  so it reports every chain file pending and `001` aborts on an already-existing table. The
  amendment serves this ADR's own requirement of "exactly one incremental migration line after
  the baseline", which is unachievable while the runner replays the chain first. The subsumed
  rows carry no checksum and assert only what `--baseline` mode asserts: the objects are
  present, do not apply these again. `npm run schema:equivalence` earns that claim and now also
  proves the runner finds nothing pending. See
  `docs/superpowers/specs/2026-09-01-greenfield-bootstrap-gap-design.md`.
  `scripts/migrate.ts`'s two guards — it refuses to run against a populated database with an
  empty ledger, and `--baseline` refuses to record a migration whose tables are missing — are
  preserved and unmodified.
```

- [ ] **Step 2: Verify no other document still claims a single row**

Run: `git grep -n "single baseline record"`

Expected: no output.

Run: `git grep -n "would be a lie"`

Expected: no output. (Task 2 removed the only occurrence.)

- [ ] **Step 3: Run the full local gate**

```bash
npm run lint
```

Expected: 0 errors, 0 warnings.

```bash
npm run typecheck
```

Expected: clean, no `error TS` lines.

```bash
npm test
```

Expected: green. A skip banner naming the integration project means it did **not** run — that
is not a pass; see the final verification below.

- [ ] **Step 4: Commit**

```bash
git add docs/adr/ADR-007-greenfield-neon-bootstrap.md
git commit -m "docs(adr): amend ADR-007 — the baseline records the chain it subsumes"
```

---

## Final verification

- [ ] `npm run schema:equivalence` → `Bootstrap proof: ok`, `EQUIVALENT`, exit 0
- [ ] `REQUIRE_INTEGRATION_TESTS=1 npm test` → green, integration project ran
- [ ] `npm run lint` → 0 errors, 0 warnings
- [ ] `npm run typecheck` → clean
- [ ] `git diff --stat main -- scripts/migrate.ts` → **no output**. This plan does not change
      the runner; if it does, approach B leaked in and the change needs re-review.

## What this does NOT establish

This makes the greenfield bootstrap *possible*. It does not perform it. Items 1.1, 1.2, 1.10
and 1.11 create real Neon resources and remain unauthorised. Do not create a project, branch
topology, or Vercel binding as part of this plan.
