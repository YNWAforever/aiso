# ADR-007 — Greenfield Neon bootstrap

- **Status:** Accepted — §24 decision 3 approved 2026-08-31 (docs/decisions/2026-08-31-phase0-stakeholder-decisions.md)
- **Date:** 2026-08-30
- **Source:** base plan §7 ADR-7, which defers wholly to plan §15

## The blocker, stated precisely

**`npm run migrate` cannot initialise a fresh Neon project.** Three independent dependencies:

1. `003_phase3a_accounts.sql:15` — `id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE
   CASCADE`. Line 33 drops and lines 34–35 create `on_auth_user_created … AFTER INSERT ON
   auth.users`. Lines 42 and 48 call `auth.uid()`. **No migration in the repository creates
   the `auth` schema, `auth.users`, or `auth.uid()`.**
2. `022_profiles_neon_auth_fk.sql` repoints `profiles.id` to `neon_auth.user`. **No migration
   creates `neon_auth`** — Neon Auth provisions it.
3. `__tests__/integration/setup.ts:13-58` documents the workaround in its own header: a Neon
   branch is copy-on-write from the parent, so branching from the old production branch
   inherits both `auth` and `neon_auth`; the harness drops and recreates only `public`.
   Creating a fresh empty database instead "would carry neither schema, so 003 and 022 could
   not apply."

Additionally `__tests__/helpers/neon-branch.ts` hard-codes the old project id (line 7), old
production branch id (line 14), and `neondb_owner` (line 22). **Passing inherited-branch
integration tests is not evidence of a fresh-project bootstrap.**

## Decision

**Option A — clean greenfield baseline.**

- Derive a reviewed **schema-only** baseline from the pinned migrations and source, in a
  **disposable** new project. Do **not** obtain it by dumping the live production database.
- Remove transitional Supabase trigger/policy dependencies from the greenfield path entirely
  — `003`'s trigger and policies are already inert (`036` dropped the policies; `auth.uid()`
  returns NULL because nothing sets the GUC).
- Enable Neon Auth **before** the baseline runs, so `neon_auth.user` exists for the
  `profiles` FK.
- Separate application-owned objects from Neon-managed ones. The baseline must not create,
  own, dump, or overwrite anything in `neon_auth`, nor provider-managed extensions, owners,
  or grants.
- Retain `001`–`037` unchanged for the existing lineage. The old project keeps its history.
- Define exactly one incremental migration line after the baseline (`038+`).
- Define the ledger starting record and an immutable baseline checksum.
- Add a reviewed **equivalence manifest** plus schema-diff and contract tests proving
  legacy-to-head and baseline-to-head converge on the same application-owned schema, grants,
  functions, indexes, constraints, and behaviour — including the seven RLS-enabled/
  zero-policy tables, `aeo_app`'s exact grant set, `BYPASSRLS`, and default privileges.

## Rejected alternative — Option B, legacy compatibility bootstrap

Enable Neon Auth first; deliberately create a minimum compatibility `auth` schema
(`auth.users`, `auth.uid()`) sufficient for `003`; replay `001`–`037` in a disposable
rehearsal; remove compatibility objects when safe. Rejected because it recreates a dead
Supabase schema in a greenfield database purely to satisfy history, `036` then drops policies
that `003` just created, removal is a further risky step, and the harness's dependency on
`auth` persists.

## Consequences

- The baseline is a new artefact requiring careful review; equivalence must be demonstrated,
  not assumed.
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
- Harness parameterisation (work item 0.8): `PROJECT_ID`, `PRODUCTION_BRANCH_ID`, and
  `OWNER_ROLE` become injected configuration, preserving every destructive-operation guard,
  especially the in-band `neon.project_id` / `neon.branch_id` GUC identity check that fails
  closed when they read null.
- **Never** apply the historical chain blindly to the new production project.

## Approval gate

Plan §24 decision 3. Trade-off if reversed: Option B recreates a dead Supabase schema in a
new database to satisfy migrations a later migration undoes.
