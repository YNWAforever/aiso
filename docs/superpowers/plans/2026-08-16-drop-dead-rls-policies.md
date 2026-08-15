# Drop the Dead RLS Policies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the 30 inert Supabase-era row-level-security policies and disable RLS on the 21 tables that carried them, so the schema stops claiming a tenancy backstop it does not have and a least-privilege database role stops being a silent data-hiding trap.

**Architecture:** One forward migration (`036`) enumerates all 30 `drop policy` statements and 21 `disable row level security` statements explicitly, then ends with a `DO` block that raises if any policy survives — so unexpected drift aborts the migration rather than passing silently. Two always-running static tests freeze the result: a scanner that no migration after `035` creates a policy, and a completeness check that `036` drops exactly what `001`–`035` created. Two assertions added to the existing integration suite prove the end state on a real database. No application code changes.

**Tech Stack:** PostgreSQL 16 on Neon, `scripts/migrate.ts` (the repo's migration runner), Vitest 4 (unit + integration projects), `@neondatabase/serverless`, `neonctl` for disposable branches.

---

## Read this before you start

**The design document is `docs/superpowers/specs/2026-08-16-drop-dead-rls-policies-design.md`.** Read it. The facts below were verified against the production database on 2026-08-16 and contradict `CLAUDE.md`, which you should not trust on this topic.

**Why this is safe.** The app connects as `neondb_owner`, which has `rolbypassrls = true`, and **no** public table sets `FORCE ROW LEVEL SECURITY`. `row_security_active()` is therefore false for every query the application makes, and these 30 policies cannot affect a single result today. Dropping them is provably a no-op on application behaviour.

**Why it matters anyway.** `auth.uid()` **exists** in production — `select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid` — and returns `NULL` under Neon because nothing sets that GUC. So pointing the app at a non-bypass role would not raise a loud "function does not exist"; it would silently return zero rows across most of the schema. `CLAUDE.md` claims the function is absent. It is not.

**Do not disable RLS on all 28 tables that have it enabled — only the 21 that carried a policy.** Migration `027` deliberately enables RLS with zero policies on the report tables as a default-deny posture, and `__tests__/db/client-report-migration.test.ts:120` pins that decision (`'enables RLS with no policies, so the report tables are default-deny'`). Seven tables keep RLS on. Disabling them would break that test and reverse someone else's deliberate choice. The exact lists are in Task 3.

**Do not touch the `auth` schema.** It is dead — an empty `auth.users` and `auth.uid()`, whose only dependencies are the policies you are dropping — but `__tests__/integration/setup.ts:30` documents why it must stay: integration branches replay every migration from `001`, and `003` needs `auth.users` and `auth.uid()` to exist. Dropping the schema breaks provisioning for every future integration run. Retiring it is a separate change that must shim the harness first.

**Do not run anything against production.** Task 8 is the only production step and it is human-only.

**This worktree has no `node_modules`.** Task 1 installs them.

---

## Task 1: Bootstrap the worktree and record the baseline

**Files:** none — this task changes nothing.

- [ ] **Step 1: Install dependencies**

Run: `npm ci`

Expected: completes without error. This worktree starts with no `node_modules`, so nothing else in this plan works until it does.

- [ ] **Step 2: Record the unit baseline**

Run: `npm run test:unit`

Expected: PASS. Write down the file and test counts from the summary line — `CLAUDE.md` records the pre-plan baseline as 136 files / 1510 tests, but trust what you actually see, not that number. You will compare against it in Task 7.

- [ ] **Step 3: Confirm lint and types are clean before you start**

Run: `npm run lint`

Expected: exits 0 with no output. This repo holds lint at 0 errors and 0 warnings.

Run: `npm run typecheck`

Expected: exits 0 with no output.

If either fails **before you have changed anything**, stop and report it — you have inherited a broken baseline and should not attribute it to your own work later.

---

## Task 2: The RLS scanner helper

Build the detector first, tested against inline fixtures. This mirrors the existing pair `__tests__/helpers/migration-role-guards.mjs` + `__tests__/migrations/role-guard-analyzer.test.mjs`; follow that shape rather than inventing a new one.

**Files:**
- Create: `__tests__/helpers/migration-rls-scan.mjs`
- Test: `__tests__/migrations/rls-scan-analyzer.test.mjs`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/migrations/rls-scan-analyzer.test.mjs`:

```js
import { describe, expect, it } from 'vitest'

import { findCreatedPolicies, findDroppedPolicies } from '../helpers/migration-rls-scan.mjs'

describe('migration RLS scanner', () => {
  it('finds a created policy and normalises the schema prefix', () => {
    const sql = 'create policy "owner_all_notifications" on public.notifications for all using (true);'

    expect(findCreatedPolicies(sql)).toEqual(['notifications.owner_all_notifications'])
  })

  it('treats a bare table name as the same table as a qualified one', () => {
    const bare = findCreatedPolicies('create policy "p" on clients for all using (true);')
    const qualified = findCreatedPolicies('create policy "p" on public.clients for all using (true);')

    expect(bare).toEqual(qualified)
    expect(bare).toEqual(['clients.p'])
  })

  it('ignores statements inside line comments', () => {
    const sql = '-- create policy "ghost" on public.scans for select using (true);\nselect 1;'

    expect(findCreatedPolicies(sql)).toEqual([])
  })

  it('is case-insensitive and tolerates newlines inside the statement', () => {
    const sql = 'CREATE POLICY "users see own account"\n  ON accounts\n  FOR ALL USING (true);'

    expect(findCreatedPolicies(sql)).toEqual(['accounts.users see own account'])
  })

  it('finds drop policy if exists statements', () => {
    const sql = 'drop policy if exists "users see own clients" on public.clients;'

    expect(findDroppedPolicies(sql)).toEqual(['clients.users see own clients'])
  })

  it('does not report a drop as a create', () => {
    expect(findCreatedPolicies('drop policy if exists "p" on public.scans;')).toEqual([])
  })

  it('does not report a create as a drop', () => {
    expect(findDroppedPolicies('create policy "p" on public.scans for all using (true);')).toEqual([])
  })

  it('reports every occurrence in file order', () => {
    const sql = [
      'create policy "a" on t1 for all using (true);',
      'create policy "b" on t2 for all using (true);',
    ].join('\n')

    expect(findCreatedPolicies(sql)).toEqual(['t1.a', 't2.b'])
  })

  it('handles a drop and a re-create of the same policy, as migration 008 does', () => {
    const sql = [
      'drop policy if exists "users insert own clients" on clients;',
      'create policy "users insert own clients" on clients for insert with check (true);',
    ].join('\n')

    expect(findDroppedPolicies(sql)).toEqual(['clients.users insert own clients'])
    expect(findCreatedPolicies(sql)).toEqual(['clients.users insert own clients'])
  })
})
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run __tests__/migrations/rls-scan-analyzer.test.mjs`

Expected: FAIL — the helper module does not exist, so the import cannot resolve.

- [ ] **Step 3: Write the helper**

Create `__tests__/helpers/migration-rls-scan.mjs`:

```js
/**
 * Find row-level-security policy statements in a migration's SQL.
 *
 * Dependency-free and side-effect-free, matching migration-role-guards.mjs
 * beside it: these run under plain node in the unit project with no database.
 *
 * Line comments are stripped first, so prose or a commented-out statement does
 * not register as a real one. Policy names in this repo are always
 * double-quoted; table names appear both bare (`clients`) and schema-qualified
 * (`public.clients`), so the schema is normalised away and every result is
 * reported as `table.policy name`.
 */

const CREATE_POLICY = /create\s+policy\s+"([^"]+)"\s+on\s+([a-z0-9_."]+)/gi
const DROP_POLICY = /drop\s+policy\s+if\s+exists\s+"([^"]+)"\s+on\s+([a-z0-9_."]+)/gi

function stripLineComments(sql) {
  return sql
    .split(/\r?\n/)
    .map((line) => line.replace(/--.*$/, ''))
    .join('\n')
}

function bareTable(name) {
  return name.replace(/"/g, '').replace(/^public\./i, '').toLowerCase()
}

function collect(sql, pattern) {
  const stripped = stripLineComments(sql)
  return [...stripped.matchAll(pattern)].map((match) => `${bareTable(match[2])}.${match[1]}`)
}

export function findCreatedPolicies(sql) {
  return collect(sql, CREATE_POLICY)
}

export function findDroppedPolicies(sql) {
  return collect(sql, DROP_POLICY)
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run __tests__/migrations/rls-scan-analyzer.test.mjs`

Expected: PASS, 9/9.

- [ ] **Step 5: Commit**

```bash
git add __tests__/helpers/migration-rls-scan.mjs __tests__/migrations/rls-scan-analyzer.test.mjs
git commit -m "test(migrations): add a scanner for RLS policy statements"
```

---

## Task 3: The migration

The completeness test drives the migration: it fails until `036` exists and drops exactly what history created.

**Files:**
- Create: `supabase/migrations/036_drop_dead_rls_policies.sql`
- Test: `__tests__/migrations/rls-policy-freeze.test.mjs`

- [ ] **Step 1: Write the failing completeness test**

Create `__tests__/migrations/rls-policy-freeze.test.mjs`:

```js
import { readdirSync, readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { findCreatedPolicies, findDroppedPolicies } from '../helpers/migration-rls-scan.mjs'

/** The migration that retires the Supabase-era policies. */
const CLEANUP = '036_drop_dead_rls_policies.sql'

const MIGRATIONS = readdirSync(new URL('../../supabase/migrations', import.meta.url))
  .filter((f) => f.endsWith('.sql'))
  .sort()

const read = (name) =>
  readFileSync(new URL(`../../supabase/migrations/${name}`, import.meta.url), 'utf8')

const numberOf = (name) => Number(name.slice(0, 3))

const createdBeforeCleanup = () =>
  MIGRATIONS.filter((m) => m !== CLEANUP).flatMap((m) => findCreatedPolicies(read(m)))

describe('RLS policy freeze', () => {
  it(`${CLEANUP} drops every policy the earlier migrations created`, () => {
    const dropped = new Set(findDroppedPolicies(read(CLEANUP)))
    const missing = [...new Set(createdBeforeCleanup())].filter((p) => !dropped.has(p)).sort()

    expect(missing).toEqual([])
  })

  it(`${CLEANUP} drops nothing that was never created`, () => {
    const created = new Set(createdBeforeCleanup())
    const stray = findDroppedPolicies(read(CLEANUP)).filter((p) => !created.has(p)).sort()

    expect(stray).toEqual([])
  })

  it('drops exactly the 30 policies verified in production on 2026-08-16', () => {
    expect(findDroppedPolicies(read(CLEANUP))).toHaveLength(30)
  })
})
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run __tests__/migrations/rls-policy-freeze.test.mjs`

Expected: FAIL — `036_drop_dead_rls_policies.sql` does not exist, so `readFileSync` throws `ENOENT`.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/036_drop_dead_rls_policies.sql`:

```sql
-- 036: retire the dead Supabase-era row-level-security policies.
--
-- These 30 policies have never fired. The app connects as neondb_owner
-- (rolbypassrls = true) and no public table sets FORCE ROW LEVEL SECURITY, so
-- row_security_active() is false for every query the application makes.
-- Dropping them cannot change any current result.
--
-- They are removed rather than left inert because auth.uid() EXISTS and returns
-- NULL under Neon -- it is
--   select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
-- and nothing sets that GUC. Pointing the app at a non-bypass role would
-- therefore NOT raise "function does not exist"; it would silently return zero
-- rows across most of the schema. Among these policies,
-- scans.auth_update_own_scan is an UPDATE policy granted to public whose
-- qualifier is literally `true` -- a cross-tenant write hole that would arm
-- itself the moment RLS became load-bearing.
--
-- RLS is disabled only on the 21 tables that carried a policy. Seven tables
-- keep RLS on with no policy at all: 027 chose that default-deny posture for the
-- report tables and __tests__/db/client-report-migration.test.ts pins it. Do not
-- add them here.
--
-- Tenancy is enforced in application code by explicit account_id filters --
-- lib/localTrust/guard.ts is the shape to copy. There is no database backstop,
-- and after this migration the schema no longer pretends otherwise.
--
-- The dead `auth` schema is deliberately NOT dropped: integration branches
-- replay every migration from 001, and 003 needs auth.users and auth.uid() to
-- exist. See __tests__/integration/setup.ts.

drop policy if exists "users see own account" on public.accounts;
drop policy if exists "ai_citation_log_own_client" on public.ai_citation_log;
drop policy if exists "owner_all_alert_configs" on public.alert_configs;
drop policy if exists "authority_overrides_own_client" on public.authority_overrides;
drop policy if exists "authority_scores_public_read" on public.authority_scores;
drop policy if exists "chunk_analysis_own_scan" on public.chunk_analysis;
drop policy if exists "users insert own clients" on public.clients;
drop policy if exists "users see own clients" on public.clients;
drop policy if exists "content_briefs_own_client" on public.content_briefs;
drop policy if exists "domain_signals_public_read" on public.domain_signals;
drop policy if exists "industry_packs_public_read" on public.industry_packs;
drop policy if exists "local_trust_actions_insert_own" on public.local_trust_actions;
drop policy if exists "local_trust_actions_select_own" on public.local_trust_actions;
drop policy if exists "local_trust_actions_update_own" on public.local_trust_actions;
drop policy if exists "local_trust_profiles_insert_own" on public.local_trust_profiles;
drop policy if exists "local_trust_profiles_select_own" on public.local_trust_profiles;
drop policy if exists "local_trust_profiles_update_own" on public.local_trust_profiles;
drop policy if exists "local_trust_snapshots_insert_own" on public.local_trust_snapshots;
drop policy if exists "local_trust_snapshots_select_own" on public.local_trust_snapshots;
drop policy if exists "local_trust_snapshots_update_own" on public.local_trust_snapshots;
drop policy if exists "owner_all_notifications" on public.notifications;
drop policy if exists "users see own profile" on public.profiles;
drop policy if exists "users see own prompts" on public.prompt_bank;
drop policy if exists "users see own metrics" on public.pulse_metrics;
drop policy if exists "users see own summary" on public.pulse_weekly_summary;
drop policy if exists "regional_packs_public_read" on public.regional_packs;
drop policy if exists "auth_insert_own_scan" on public.scans;
drop policy if exists "auth_update_own_scan" on public.scans;
drop policy if exists "public_read_scan_by_id" on public.scans;
drop policy if exists "topical_clusters_own_client" on public.topical_clusters;

-- The 21 tables that carried a policy. NOT the seven default-deny tables:
-- account_report_branding, authenticated_scan_monthly_usage,
-- client_report_versions, client_reports, public_scan_rate_limits,
-- stripe_subscription_processing_leases, stripe_webhook_events.
alter table if exists public.accounts disable row level security;
alter table if exists public.ai_citation_log disable row level security;
alter table if exists public.alert_configs disable row level security;
alter table if exists public.authority_overrides disable row level security;
alter table if exists public.authority_scores disable row level security;
alter table if exists public.chunk_analysis disable row level security;
alter table if exists public.clients disable row level security;
alter table if exists public.content_briefs disable row level security;
alter table if exists public.domain_signals disable row level security;
alter table if exists public.industry_packs disable row level security;
alter table if exists public.local_trust_actions disable row level security;
alter table if exists public.local_trust_profiles disable row level security;
alter table if exists public.local_trust_snapshots disable row level security;
alter table if exists public.notifications disable row level security;
alter table if exists public.profiles disable row level security;
alter table if exists public.prompt_bank disable row level security;
alter table if exists public.pulse_metrics disable row level security;
alter table if exists public.pulse_weekly_summary disable row level security;
alter table if exists public.regional_packs disable row level security;
alter table if exists public.scans disable row level security;
alter table if exists public.topical_clusters disable row level security;

-- Fail closed. The enumeration above is the inventory verified in production on
-- 2026-08-16. If this database carries a policy that was not in that inventory,
-- abort rather than leave it behind silently: the runner wraps each migration in
-- a transaction, so raising here rolls the whole file back and leaves the ledger
-- unmarked. Re-run once the surprise is understood.
do $$
declare
  leftover text;
begin
  select string_agg(tablename || '.' || policyname, ', ' order by tablename, policyname)
    into leftover
    from pg_policies
   where schemaname = 'public';

  if leftover is not null then
    raise exception 'unexpected RLS policies remain in public: %', leftover;
  end if;
end $$;
```

**Note on the `DO` block:** `scripts/migrate.ts` rejects a migration containing its own `begin`/`commit`/`rollback`, because the runner supplies the transaction. That check strips dollar-quoted bodies first (see the comment at `scripts/migrate.ts:128`), so the `begin` and `end` inside `$$ … $$` are invisible to it and this file is accepted. Do not restructure the block to avoid them.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run __tests__/migrations/rls-policy-freeze.test.mjs`

Expected: PASS, 3/3. If "drops every policy the earlier migrations created" fails, the printed array names policies present in `001`–`035` but missing from your file — add them. If "drops nothing that was never created" fails, you have a typo in a policy or table name.

- [ ] **Step 5: Confirm the runner accepts the file**

Run: `npx vitest run __tests__/supabase/migration-contract.test.ts`

Expected: PASS. This suite reads every migration off disk, so `036` is covered automatically. Two of its tests matter here:

- `'contains no transaction control statements'` — passes because `assertNoTransactionControl` strips dollar-quoted bodies before looking, so the `begin`/`end` inside `do $$ … $$` are invisible to it. If this fails, the stripping did not behave as this plan says: **stop and report it — do not delete the fail-closed assertion block to make it pass.**
- `'uses unique, numerically sorted migration prefixes'` — passes because `036` follows `035` and no other file claims that prefix.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/036_drop_dead_rls_policies.sql __tests__/migrations/rls-policy-freeze.test.mjs
git commit -m "feat(db): drop the dead Supabase-era RLS policies"
```

---

## Task 4: The regression guard

Stop a future migration from reintroducing a policy. **Ban `create policy` only — do not ban `enable row level security`.** Enabling RLS with no policy is an endorsed pattern here (`027`), so banning it would contradict the decision this plan is built on.

**Files:**
- Modify: `__tests__/migrations/rls-policy-freeze.test.mjs`

- [ ] **Step 1: Add the guard tests**

Add these two tests inside the existing `describe('RLS policy freeze', …)` block in `__tests__/migrations/rls-policy-freeze.test.mjs`, above the existing ones:

```js
  /**
   * Migrations that legitimately create policies. Frozen rather than derived.
   *
   * neon-role-portability.test.mjs:8 records why a hand-maintained list of
   * migration names is normally wrong here -- one rotted, "which is how 029 went
   * unregistered". This list is different in kind: it names applied, immutable
   * history, and nothing has to be added to it when a migration is written,
   * because new files are covered by the `> 035` rule below. Its job is to prove
   * the scanner still detects anything at all, so the guard cannot quietly
   * become a no-op.
   */
  const HISTORICAL_POLICY_MIGRATIONS = [
    '003_phase3a_accounts.sql',
    '004_phase3a_clients_fk.sql',
    '008_scans_account_id.sql',
    '010_phase3b.sql',
    '012_aiso_v3.sql',
    '020_scans_public_select.sql',
    '021_local_trust_roi.sql',
  ]

  it('still detects the historical policy migrations', () => {
    const found = MIGRATIONS.filter((m) => findCreatedPolicies(read(m)).length > 0)

    expect(found).toEqual(HISTORICAL_POLICY_MIGRATIONS)
  })

  it('no migration after 035 creates a policy', () => {
    const offenders = MIGRATIONS.filter((m) => numberOf(m) > 35).flatMap((m) =>
      findCreatedPolicies(read(m)).map((policy) => `${m}: ${policy}`),
    )

    expect(offenders).toEqual([])
  })
```

- [ ] **Step 2: Run the tests to verify they pass**

Run: `npx vitest run __tests__/migrations/rls-policy-freeze.test.mjs`

Expected: PASS, 5/5.

- [ ] **Step 3: Prove the guard actually bites**

A guard that cannot fail is worthless. Create a throwaway migration:

```bash
printf 'create policy "regression" on public.clients for all using (true);\n' > supabase/migrations/999_guard_probe.sql
```

Run: `npx vitest run __tests__/migrations/rls-policy-freeze.test.mjs`

Expected: **FAIL** — "no migration after 035 creates a policy" reports `999_guard_probe.sql: clients.regression`. The completeness tests may also fail, which is fine.

Now delete it:

```bash
rm supabase/migrations/999_guard_probe.sql
```

Run: `npx vitest run __tests__/migrations/rls-policy-freeze.test.mjs`

Expected: PASS, 5/5.

Confirm the probe is gone before committing:

```bash
git status --porcelain supabase/migrations/
```

Expected: no `999_guard_probe.sql` in the output.

- [ ] **Step 4: Commit**

```bash
git add __tests__/migrations/rls-policy-freeze.test.mjs
git commit -m "test(migrations): block a new migration from creating an RLS policy"
```

---

## Task 5: The integration end-state assertions

Prove the migration reaches its intended end state against a real database — including that its own fail-closed block passed.

**Files:**
- Modify: `__tests__/integration/migrate.test.ts`

- [ ] **Step 1: Add the assertions**

Add these two tests to the existing `describe('migration runner against a real branch', …)` block in `__tests__/integration/migrate.test.ts`, after the test `'creates the account override columns from 028'`:

```ts
  it('leaves no RLS policies in the public schema after 036', async () => {
    const rows = await sql`
      select tablename, policyname from pg_policies
      where schemaname = 'public'
      order by tablename, policyname
    `
    expect(rows).toEqual([])
  })

  it('keeps RLS enabled on exactly the deliberate default-deny tables', async () => {
    // 027 chose RLS-on-with-no-policies for the report tables as default-deny,
    // pinned by __tests__/db/client-report-migration.test.ts. 036 leaves these
    // alone. Pinning the exact set fails both ways: a table losing the posture,
    // and a new table quietly enabling RLS without review.
    const rows = await sql`
      select c.relname as table_name
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity
      order by c.relname
    `
    expect(rows.map((r) => r.table_name)).toEqual([
      'account_report_branding',
      'authenticated_scan_monthly_usage',
      'client_report_versions',
      'client_reports',
      'public_scan_rate_limits',
      'stripe_subscription_processing_leases',
      'stripe_webhook_events',
    ])
  })
```

- [ ] **Step 2: Run the integration suite**

Run: `npm run test:integration`

Expected: PASS, including both new tests. This provisions a real Neon branch and requires `neonctl` on PATH and authenticated.

**If `neonctl` is unavailable** the project skips with a banner. A skip is not a pass. Record in your report that the integration assertions were not executed, and say so plainly — do not describe this task as verified.

- [ ] **Step 3: Commit**

```bash
git add __tests__/integration/migrate.test.ts
git commit -m "test(integration): pin the RLS end state after 036"
```

---

## Task 6: Correct the documentation

`CLAUDE.md` is wrong on this topic in a way that would mislead the next reader, and a comment in the integration harness refers to a cleanup that has now happened in part.

**Files:**
- Modify: `CLAUDE.md` (the Database section)
- Modify: `__tests__/integration/setup.ts` (the comment block above `resetPublicSchema`)

- [ ] **Step 1: Replace the two RLS bullets in `CLAUDE.md`**

Find these two bullets in the Database (Neon Postgres) section and delete them entirely:

```markdown
- **RLS is enabled but inert — never rely on it.** *(Counts below are unverified — they need
  a live connection to check `pg_class.relrowsecurity`, `pg_policies` and `pg_roles`. The
  conclusion holds regardless: nothing here is a backstop.)* 22 of 27 public tables still have
  `relrowsecurity = true` carrying 21 leftover Supabase-era policies that call `auth.uid()`.
  They never fire: the app connects as `neondb_owner`, which has `rolbypassrls = true`, and
  no table sets FORCE ROW LEVEL SECURITY — so `row_security_active()` is false everywhere.
  **Every query must filter by `account_id` explicitly.** There is no effective backstop.
- **Latent hazard:** point the app at a non-owner Neon role (or `ALTER ROLE … NOBYPASSRLS`)
  and those 21 policies activate. `auth.uid()` is a Supabase function that does not exist
  under Neon Auth, so nearly every query silently returns zero rows. Drop the dead policies
  before introducing a least-privilege role.
```

Replace them with:

```markdown
- **There is no database-level tenancy backstop. Every query must filter by `account_id`
  explicitly.** Migration `036` dropped all 30 Supabase-era policies and disabled RLS on the
  21 tables that carried them. `__tests__/migrations/rls-policy-freeze.test.mjs` fails if a
  migration after `035` creates a policy, so this does not grow back by accident.
- **Seven tables keep RLS enabled with no policies, on purpose** —
  `account_report_branding`, `authenticated_scan_monthly_usage`, `client_report_versions`,
  `client_reports`, `public_scan_rate_limits`, `stripe_subscription_processing_leases`,
  `stripe_webhook_events`. `027` chose that default-deny posture and
  `__tests__/db/client-report-migration.test.ts` pins it. The integration suite pins the exact
  set, so adding an eighth is a deliberate, reviewed change. Note it buys little on its own:
  `027` also revokes table privileges, and a role without grants gets a loud permission error
  before RLS is ever consulted.
- **`auth.uid()` exists — it does not error, it returns NULL.** An earlier version of this file
  claimed the function was absent under Neon. It is present:
  `select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid`, and nothing sets
  that GUC. That is why the dead policies were a *silent* hazard rather than a loud one, and
  why they were removed rather than left inert.
- **The dead `auth` schema is deliberately retained.** It holds an empty `auth.users` and
  `auth.uid()`. Integration branches replay every migration from `001`, and `003` needs both to
  exist — see `__tests__/integration/setup.ts`. Retiring it means shimming that harness first.
- Verified against production on 2026-08-16: 34 public tables, `neondb_owner` has
  `rolbypassrls = true`, no table sets FORCE ROW LEVEL SECURITY. `neon_auth` is the one login
  role that does **not** bypass RLS.
```

- [ ] **Step 2: Update the harness comment**

In `__tests__/integration/setup.ts`, find this text inside the comment block above `resetPublicSchema`:

```
 *   auth      — the DEAD Supabase schema. Migration 003 FKs auth.users and
 *               there are 31 auth.uid() call sites across 8 files. Nothing
 *               here creates it either.
 *
 * That second one is a trap: CLAUDE.md calls for dropping the dead `auth`
 * schema and its inert policies. Doing so would stop this harness being able
 * to provision a branch at all, because setup re-runs 003 from scratch every
 * time. Retiring `auth` means shimming it here first.
```

Replace it with:

```
 *   auth      — the DEAD Supabase schema. Migration 003 FKs auth.users and
 *               calls auth.uid() in the policies it creates. Nothing here
 *               creates the schema either.
 *
 * That second one is a trap, and it is why `auth` is still here. Migration 036
 * dropped the inert policies, but deliberately did NOT drop this schema:
 * doing so would stop this harness provisioning a branch at all, because setup
 * re-runs 003 from scratch every time and 003 needs auth.users and auth.uid()
 * to exist. Retiring `auth` means shimming it here first, and is its own change.
```

Note the replacement also drops the stale "31 auth.uid() call sites across 8 files" count, which no longer holds after `036`.

- [ ] **Step 3: Verify nothing else in the repo still asserts the old claims**

Run: `grep -rn "does not exist under Neon\|22 of 27\|21 leftover" CLAUDE.md README.md docs/ __tests__/ 2>/dev/null`

Expected: no output. If a line appears, correct it the same way — leaving a contradicting copy is worse than not having written the correction.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md __tests__/integration/setup.ts
git commit -m "docs: correct the RLS section against the verified state"
```

---

## Task 7: Full verification

**Files:** none, unless a check fails.

- [ ] **Step 1: Run the unit suite**

Run: `npm run test:unit`

Expected: PASS, every file. Two new unit files were added, totalling **+14 tests** over your Task 1 baseline: `rls-scan-analyzer.test.mjs` has 9, and `rls-policy-freeze.test.mjs` has 5 (3 written in Task 3, 2 added in Task 4). The two integration tests from Task 5 are in the other project and do not count here. If the total moved by any other amount, work out why before continuing.

- [ ] **Step 2: Confirm the pre-existing RLS test still passes**

Run: `npx vitest run __tests__/db/client-report-migration.test.ts`

Expected: PASS. This is the test that pins `027`'s default-deny decision. If it fails, you disabled RLS on one of the seven tables that must keep it — remove that `alter table` line from `036`.

- [ ] **Step 3: Lint and typecheck**

Run: `npm run lint`

Expected: exits 0, no output.

Run: `npm run typecheck`

Expected: exits 0, no output. Note `tsconfig.json` excludes `__tests__`, so this will not typecheck the files you added — that is pre-existing and not yours to fix here.

- [ ] **Step 4: Run the whole suite including integration**

Run: `REQUIRE_INTEGRATION_TESTS=1 npm test`

Expected: PASS for both projects. This is the command that proves the full suite ran rather than silently skipping integration.

If `neonctl` is unavailable this **fails rather than skips**, by design. In that case run `npm test` instead, and state clearly in your report that the integration project did not execute.

- [ ] **Step 5: Confirm the working tree is clean**

Run: `git status --porcelain`

Expected: no output. In particular there must be no leftover `999_guard_probe.sql`.

---

## Task 8: Apply to production (HUMAN ONLY — agents stop here)

**Files:** none. This task changes a database, not code.

> **Agents: do not perform this task.** Hand it to the human along with this plan. Do not connect to production, do not run `npm run migrate` against it, and do not offer to.

- [ ] **Step 1: Confirm the ledger is clean before starting**

Run: `npm run migrate -- --verify`

Expected: `001`–`035` all report `recorded`. Two entries look alarming and are not: `014` reports `MISSING plan_features` because `028` drops that table on purpose, and column-only migrations report `n/a`.

- [ ] **Step 2: Preview**

Run: `npm run migrate -- --dry-run`

Expected: `036_drop_dead_rls_policies.sql` is the only pending migration.

- [ ] **Step 3: Apply**

Run: `npm run migrate`

Expected: `036` applies and is recorded.

**If it aborts with `unexpected RLS policies remain in public: …`**, a policy exists that was not in the 2026-08-16 inventory. Nothing was applied — the transaction rolled back and the ledger is unmarked. Do not force it through. Read the named policy, work out where it came from, and extend `036` to cover it.

- [ ] **Step 4: Verify**

Run: `npm run migrate -- --verify`

Expected: `036` reports `recorded`.

- [ ] **Step 5: Confirm the end state directly**

Confirm against the database that `select count(*) from pg_policies where schemaname = 'public'` is `0`, and that the tables with `relrowsecurity = true` are exactly the seven default-deny ones. Do not paste a connection string into a shell command — the driver echoes the full URL including the password in its error messages.

---

## What this plan deliberately does not do

- **It does not drop the `auth` schema.** Dead, but load-bearing for integration branch provisioning until that harness is shimmed. Its own change.
- **It does not introduce the least-privilege database role.** This unblocks that work; it does not perform it. Doing so also needs the `revoke`/`grant` posture reviewed, which is a larger question than RLS.
- **It does not reverse `027`'s default-deny posture** on the seven zero-policy tables, even though the REVOKEs appear to do the real work. That is a decision for whoever owns `027`, on tables holding customer reports and Stripe state.
- **It does not change any application code.** The policies are provably inert today, so there is nothing in `app/`, `lib/`, or `components/` to adjust.
