# Drop the Dead RLS Policies — Design

**Date:** 2026-08-16
**Status:** approved, ready for planning
**Goal:** Remove the 30 inert Supabase-era row-level-security policies and the RLS
flags they hang off, so the schema states what is actually true — tenancy is enforced
by explicit `account_id` filters in application code — and so pointing the app at a
non-superuser role stops being a silent, data-hiding trap.

---

## Read this first: the documented state was wrong

`CLAUDE.md` describes this hazard, and marks its own numbers as unverified. They were
checked against the production database (`neondb`, role `neondb_owner`) on
**2026-08-16**. Four of its five claims are wrong, and the correction makes the hazard
**worse**, not milder.

| `CLAUDE.md` claim | Verified reality |
|---|---|
| 22 of 27 public tables have `relrowsecurity = true` | **28 of 34** |
| carrying **21** leftover policies | **30 policies**, spread across 21 tables — 21 was the *table* count |
| `auth.uid()` "is a Supabase function that **does not exist** under Neon Auth" | **It exists.** `create or replace function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$` |
| no table sets `FORCE ROW LEVEL SECURITY` | correct — none do |
| the app connects as `neondb_owner`, which has `rolbypassrls = true` | correct |

**Why the `auth.uid()` correction is the important one.** If the function were absent,
switching to a non-bypass role would raise `function auth.uid() does not exist` — loud,
immediate, unmissable. Because it exists and returns `NULL` (nothing under Neon sets the
`request.jwt.claim.sub` GUC), every `USING (id = auth.uid())` evaluates to `NULL`, which
is not `TRUE`, so the row is filtered out. The *conclusion* in `CLAUDE.md` — "silently
returns zero rows" — is right. Its *reason* is backwards, and the real reason is the one
that fails quietly instead of loudly.

### Three failure modes, not one

`CLAUDE.md` documents only the first.

1. **23 policies reference `auth.uid()`** → the qual is `NULL` → silently match nothing.
2. **7 tables have RLS enabled with zero policies** → deny-all. `SELECT` returns nothing;
   `INSERT` raises `new row violates row-level security policy`. These are
   `account_report_branding`, `authenticated_scan_monthly_usage`, `client_report_versions`,
   `client_reports`, `public_scan_rate_limits`, `stripe_subscription_processing_leases`,
   `stripe_webhook_events` — the revenue, reporting and rate-limit paths.
3. **7 policies never reference `auth.uid()`.** Six have `qual = true`
   (`authority_scores`, `domain_signals`, `industry_packs`, `regional_packs`,
   `scans.public_read_scan_by_id`, `scans.auth_update_own_scan`); the seventh,
   `scans.auth_insert_own_scan`, has no qual and `with_check = true`. All are granted to
   `{public}`, so all stay permissive rather than denying. Among them
   `scans.auth_update_own_scan` is an `UPDATE` policy named "own scan" whose qualifier is
   literally `true`. That one is not dead weight. It is a cross-tenant write hole that
   **arms itself** the moment RLS becomes load-bearing.

All 30 policies target the `{public}` role.

### Why RLS cannot simply be made to work here

`db()` uses the Neon **HTTP** driver, where each query is an independent one-shot request.
`SET LOCAL request.jwt.claim.sub = …` cannot survive to the next call. Making these
policies function would mean abandoning the stateless HTTP driver for pooled WebSocket
sessions and touching every `db()` call site. That is a different project; it is not this
one, and it is not currently wanted.

---

## Core safety property

`neondb_owner` has `rolbypassrls = true`, and **no** public table sets
`FORCE ROW LEVEL SECURITY`. Therefore `row_security_active()` is false for every query the
application makes today, and these 30 policies cannot affect a single result.

**Dropping them is provably a no-op on application behaviour.** This change alters what the
schema claims and disarms what would activate under a non-bypass role. It does not alter
what any current query returns. That is why it ships without touching `app/`, `lib/`, or
`components/`.

---

## Scope

**In scope**

- Drop all 30 policies.
- `DISABLE ROW LEVEL SECURITY` on the **21** tables that carried them.
- A static guard preventing a new migration from creating a policy.
- An integration assertion proving the end state on a real database.
- Correct `CLAUDE.md`; correct the stale comment in `__tests__/integration/setup.ts`.

### The 7 zero-policy tables keep RLS — deliberately

Failure mode 2 below describes 7 tables with RLS enabled and no policy. For three of them
this is **not an accident**: `027` chose it, and
`__tests__/db/client-report-migration.test.ts:120` pins it —
*"enables RLS with no policies, so the report tables are default-deny"*. That decision is
respected here. RLS is disabled only on the 21 tables that carried a policy; the 7 keep
their posture and that test stays green.

The counter-argument, recorded so it is not rediscovered from scratch: `027` also does
`revoke all on table … from public`, so a least-privilege role without grants gets a **loud**
permission error before RLS is consulted, and a role *with* grants gets a silent empty result
instead of a loud one. The REVOKEs appear to be doing the real work. This was raised on
2026-08-16 and the deliberate posture was kept — reversing it is a separate decision for
whoever owns `027`, on tables holding customer reports and Stripe state.

This narrowing costs nothing against the stated goal: those 7 tables were already
policy-free, so nothing about them blocks a least-privilege role.

**Out of scope, deliberately**

- **Retiring the dead `auth` schema.** It holds an empty `auth.users` (0 rows) and
  `auth.uid()`, whose only 26 dependencies are the policies being dropped — so it is
  entirely dead after this change. It stays anyway, because
  `__tests__/integration/setup.ts:30` documents the trap: test branches are copy-on-write
  from production, get `drop schema public cascade`, then replay every migration from
  `001`. `auth` survives outside `public`, which is the only reason `003` can still create
  its `auth.users` foreign key and its `auth.uid()` policies on replay. Production itself
  no longer carries that FK (`022` moved `profiles.id` to `neon_auth."user"`), but **replay
  still needs the objects to exist.** Dropping `auth` breaks provisioning for every future
  integration run, whose failure mode is "no integration test can run at all". Retiring it
  requires shimming the harness first, and is its own change.
- **Introducing the least-privilege database role.** This change unblocks it; it does not
  perform it.
- **Rewriting policies to work under Neon Auth.** See the HTTP-driver constraint above.

The `scans.auth_update_own_scan` hole is resolved incidentally — it is one of the 30.

---

## Architecture

One forward migration, two tests, two documentation corrections. No application code changes.

| File | Change |
|---|---|
| `supabase/migrations/036_drop_dead_rls_policies.sql` | **new** — 30 drops, 21 disables, fail-closed assertion |
| `__tests__/migrations/rls-policy-freeze.test.mjs` | **new** — static guard over the SQL files |
| `__tests__/integration/migrate.test.ts` | **modify** — add the end-state assertions |
| `CLAUDE.md` | corrected RLS section |
| `__tests__/integration/setup.ts` | comment at `:30` updated to record the decision |

Two structural choices, both to match existing repo patterns rather than invent new ones:

- The guard is `.mjs` and lives beside `neon-role-portability.test.mjs` /
  `role-guard-analyzer.test.mjs`, which are the existing migration-scanning tests.
- The end-state assertions are **added to `__tests__/integration/migrate.test.ts`** rather
  than given a new file. That suite is already "migration runner against a real branch" and
  already asserts post-migration schema state (`027`'s tables, `028`'s columns). Adding a
  file would provision a second Neon branch for no benefit.

### The migration

Approach: **explicit enumeration plus a fail-closed assertion.** The enumeration makes the
diff the inventory — a reviewer sees exactly what disappears, and it replays identically in
every environment. The assertion supplies what enumeration alone lacks: if the database
carries a policy that was not inventoried on 2026-08-16, the migration **aborts** rather
than silently leaving it behind.

A catalog-driven `DO` loop was rejected: it converges on the same end state but its diff
says nothing about what it removes, its behaviour differs per environment, and it would
swallow exactly the drift worth knowing about.

Structure:

```sql
-- 036_drop_dead_rls_policies.sql
--
-- These 30 policies have never fired. The app connects as neondb_owner
-- (rolbypassrls = true) and no table sets FORCE ROW LEVEL SECURITY, so
-- row_security_active() is false for every query. Dropping them cannot change
-- any current result.
--
-- They are removed rather than left inert because auth.uid() EXISTS and returns
-- NULL under Neon (nothing sets request.jwt.claim.sub). Pointing the app at a
-- non-bypass role would therefore not error -- it would silently return zero
-- rows across most of the schema, deny-all on the 7 tables that have RLS on with
-- no policy at all, and leave scans.auth_update_own_scan (UPDATE, USING true,
-- granted to public) as a live cross-tenant write hole.
--
-- Tenancy is enforced in application code by explicit account_id filters.
-- See lib/localTrust/guard.ts for the shape. There is no database backstop, and
-- after this migration the schema no longer pretends otherwise.

drop policy if exists "users see own account" on public.accounts;
-- ... 29 more, one per line, ordered by table then policy name

-- Only the 21 tables that carried a policy. The 7 that have RLS on with no
-- policy at all are left alone on purpose: 027 chose default-deny for the
-- report tables and __tests__/db/client-report-migration.test.ts pins it.
alter table if exists public.accounts disable row level security;
-- ... 20 more, ordered by table name

do $$
declare leftover text;
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

`DROP POLICY IF EXISTS` and `ALTER TABLE IF EXISTS` keep the file replay-safe on a branch
where an object is absent.

The complete 30 `drop policy` lines and 21 `alter table` lines are in **Appendix A** below,
generated from the verified production inventory rather than retyped.

### Error handling

`scripts/migrate.ts` runs each migration in its own transaction. A raised exception rolls
the whole file back and leaves the ledger unmarked — no half-applied state, and the
migration can be re-run once the surprise is understood. An unexpected policy blocking the
deploy until a human looks is the correct outcome for a security cleanup, and matches this
repo's established instinct: `migrate --verify`, the `ON CONFLICT` arbiter pin, and "never
return a success over a failed write".

### Migration ordering and replay

`036` runs last. On a fresh Neon test branch the harness drops `public`, replays `001`–`035`
(which create all 30 policies and enable RLS on 28 tables), then `036` drops all 30 policies
and disables RLS on 21 of those tables, leaving the 7 default-deny ones enabled. The end
state matches production. `auth` is untouched, so `003` still resolves `auth.users` and
`auth.uid()` during replay.

---

## Testing

### Static guard — `__tests__/migrations/rls-policy-freeze.test.mjs`

Runs in the unit project, needs no database, so it never skips.

**It bans `create policy` only — not `enable row level security`.** Enabling RLS with no
policy is now an endorsed pattern in this codebase (`027`), so banning it would contradict
the decision recorded above. A *policy* is the thing that silently denies, and is the
regression worth blocking.

Scope is derived from the filename number, **not from a hand-maintained allowlist**.
`__tests__/migrations/neon-role-portability.test.mjs:8` records why: an earlier
hand-maintained array of migration names rotted, "which is how 029 went unregistered", and
was replaced by reading the directory. So:

- every migration numbered **> 035** must contain no `create policy`, and a new migration is
  in scope automatically, with nothing to remember;
- the historical files are pinned by exact list — `create policy` appears in exactly
  `003`, `004`, `008`, `010`, `012`, `020`, `021` — which is safe to freeze because applied
  migrations are immutable. This is the second direction: it fails if the scanner stops
  detecting, so the guard cannot silently become a no-op.

`--` line comments are stripped before matching, so prose mentioning a policy does not trip
it. Note `\benable\s+row\s+level\s+security\b` does not match inside `disable row level
security` (`disable` does not contain `enable`), verified — but the guard does not use that
pattern anyway.

### Integration assertions — added to `__tests__/integration/migrate.test.ts`

That suite already provisions a disposable branch and replays every migration. Two
assertions are added:

- `select count(*) from pg_policies where schemaname = 'public'` is `0`;
- the set of `public` tables with `relrowsecurity = true` is **exactly** the 7 deliberate
  default-deny tables.

The second is stronger than "no RLS anywhere": it pins the kept posture, so both a
regression (a table losing default-deny) and an unreviewed addition (a new table quietly
enabling RLS) fail. Together they prove the migration reached its end state — including that
its own fail-closed assertion passed — rather than that its text merely looks right. Per
`CLAUDE.md` this project skips without `neonctl`; the static guard is the one that always
runs.

---

## Documentation corrections

**`CLAUDE.md`** — the RLS bullet and the "Latent hazard" bullet are replaced. The new text
records: the verified counts (34 / 28 / 30) as of 2026-08-16; that `auth.uid()` **exists**
and returns `NULL`, so the failure mode is silence rather than error; that the policies and
flags are now gone; that `auth` was deliberately retained and why; and that explicit
`account_id` filtering remains the only tenancy enforcement.

**`__tests__/integration/setup.ts`** — the comment at `:30` says *"CLAUDE.md calls for
dropping the dead `auth` schema and its inert policies"*. After this change the policies are
gone but the schema deliberately is not. The comment is updated to say the schema is kept
**on purpose**, that this harness is the reason, and that retiring it still requires shimming
`auth` here first.

---

## Production application

A human step, following repo convention. The agent does not connect to production.

1. `npm run migrate -- --verify` — confirm `001`–`035` are recorded before starting.
2. `npm run migrate` — applies `036` only.
3. `npm run migrate -- --verify` — confirm `036` is recorded.
4. Re-run the read-only inventory to confirm 0 policies and 0 RLS-enabled tables in `public`.

If step 2 aborts with `unexpected RLS policies remain`, a policy exists that was not in the
2026-08-16 inventory. Do not force it through: read the named policy, work out where it came
from, and extend the migration.

---

## Verification of the inventory

The 30 `CREATE POLICY` statements in the migration files and the 30 live policies in
production were counted and matched, but **not diffed name-by-name**. The implementation
must assert the two sets are identical before the enumeration is trusted. If they differ,
the fail-closed assertion catches it at apply time, but catching it at authoring time is
cheaper.

---

## Environment note

This worktree has **no `node_modules`**. Implementation begins with `npm ci`.

---

## Appendix A — the verified inventory (production, 2026-08-16)

### The 30 policies

```sql
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
```

### The 21 tables to disable (each carried at least one policy)

```sql
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
```

### The 7 tables that KEEP RLS — do not add `alter table` lines for these

`account_report_branding`, `authenticated_scan_monthly_usage`, `client_report_versions`,
`client_reports`, `public_scan_rate_limits`,
`stripe_subscription_processing_leases`, `stripe_webhook_events`.

RLS on, zero policies, default-deny — deliberate for the `027` report tables and left
consistent across all seven. This is the exact set the integration assertion pins.

### The 6 tables that already have RLS off

`agent_competitors`, `agent_progress`, `agent_recommendations`, `alert_email_deliveries`,
`fix_packs`, `schema_migrations`. They need no `alter table` line and must not gain one.

21 disabled + 7 kept = the 28 that had RLS on; plus these 6 = 34 public tables.

### Login roles

| Role | `rolbypassrls` | `rolsuper` |
|---|---|---|
| `cloud_admin` | true | true |
| `neon_service` | true | false |
| `neondb_owner` | true | false |
| `neon_auth` | **false** | false |

`neon_auth` is the one existing login role that does **not** bypass RLS. It is provisioned
by Neon Auth and operates on the `neon_auth` schema, not `public`; no `public` table is
known to be read through it. It is recorded here because it is the role a least-privilege
experiment would most plausibly reach for first.
