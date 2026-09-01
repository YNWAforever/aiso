# Greenfield Neon baseline — design and rehearsal plan

**Status:** Design approved (ADR-007); rehearsal not yet run — blocked on item 1.1 (Neon
resource creation, not authorized)
**Date:** 2026-08-31
**Governs:** base plan §15, ADR-007, plan items 1.3, 1.5, 1.7, 1.11

## What this document adds beyond ADR-007

ADR-007 records the *decision* (Option A). This document is the actionable sequence for
*executing* it, so item 1.3 ("author reviewed schema-only baseline", flagged in the base plan
as an epic needing decomposition) has a concrete starting checklist rather than a blank page.

## Baseline authoring sequence

1. Start from `supabase/migrations/001`–`037` as the source of truth for every
   application-owned object (tables, columns, constraints, indexes, triggers, functions,
   grants).
2. Exclude every object that is Neon-managed or Supabase-transitional and inert:
   - The `auth` schema and its trigger/policies (migration `003`) — dead under Neon,
     `auth.uid()` returns NULL, retained today only for the OLD harness's dependency.
   - The 30 policies migration `036` already dropped — do not recreate them.
   - `neon_auth` itself — provisioned by enabling Neon Auth, never by SQL in this repo.
3. Preserve every object migration `037` and its predecessors established as load-bearing,
   including active triggers such as `clients`'s `before insert` trigger
   `enforce_brand_limit` (defined by `011`, redefined by `026` and `028`) — a live,
   security-relevant object easy to drop by accident since it lives in `pg_trigger`, a
   different catalog from the function it calls:
   - `aeo_app`'s exact grant set (blanket DML on `public`, `USAGE`/`SELECT` on sequences,
     `SELECT` on `neon_auth."user"`, default privileges for future tables) and its
     `BYPASSRLS` flag.
   - The seven RLS-enabled/zero-policy tables, each keeping the posture its *creating*
     migration gave it (`023`, `024`, `025`, `027` — see `CLAUDE.md`'s Database section for
     the exact four-migration breakdown).
   - `pgcrypto` in `public` (created by `027`).
4. Write the baseline as a single reviewed SQL file, e.g. `000_baseline_2026-08-30.sql`,
   organized in the same dependency order the numbered migrations already establish
   (accounts → clients → scans → ... → grants last).
5. Do **not** obtain the baseline by `pg_dump`-ing the live production database — author it
   from the migration source, reviewed line by line against the equivalence manifest (below).

**Scope note — 1.3 vs. 1.4.** The base plan tracks the schema baseline (item 1.3) and the
roles/grants/`BYPASSRLS` fail-closed check (item 1.4, depending on 1.3) as separate items.
Step 3 above folds role/grant preservation into the same reviewed SQL file for practical
reasons (the rehearsal in this document has nowhere else to run them from), but item 1.4
still owns its own explicit fail-closed verification — mirroring `037`'s own pattern of
asserting `BYPASSRLS` took effect rather than assuming the `CREATE ROLE`/`GRANT` statements
succeeded silently. Treat step 3's grants as 1.3's draft; 1.4 is the review and the
fail-closed check on top of it, not a no-op.

## Equivalence manifest

A companion document proving legacy-to-head and baseline-to-head converge on the same
application-owned schema. Structure:

| Object class | Legacy-to-head source | Baseline-to-head source | Diff method |
|---|---|---|---|
| Tables + columns | `001`-`037` applied in order | `000_baseline` alone | `information_schema.columns` diff |
| Constraints | same | same | `information_schema.table_constraints` diff for presence, plus `pg_get_constraintdef` (or `information_schema.check_constraints.check_clause`) diff for check-constraint bodies — presence alone does not prove two differently-worded `check(...)` predicates match |
| Indexes | same | same | `pg_indexes` diff |
| Triggers | same | same | `pg_trigger` diff, application-owned tables only — presence AND the function each trigger calls; a function existing in the `pg_proc` diff below does not prove it is still attached to the table |
| Functions | same | same | `pg_proc` diff, application-owned schemas only |
| Grants (aeo_app) | same | same | `information_schema.role_table_grants` diff, `aeo_app` only |
| RLS posture | same | same | `pg_tables.rowsecurity` + `pg_policies` diff, all 34 tables |

This manifest is authored alongside the baseline SQL in item 1.3, then exercised by the
schema-diff and contract tests in item 1.7.

## Migration ledger and checksum (item 1.5)

`schema_migrations` in the new project starts with the baseline record (e.g.
`000_baseline_2026-08-30.sql`) plus an immutable checksum of that file, **and one row for each
migration the baseline subsumes**. Two existing guards in
`scripts/migrate.ts` are preserved unchanged, not reimplemented: it already refuses to run
against a populated database with an empty ledger, and `--baseline` already refuses to record
a migration whose tables are missing. Future migrations continue in filename order from `039`.

> **Amended 2026-09-01.** Three corrections. (1) "A single baseline record" left the database
> **unbootstrappable**: `planMigrations` (`scripts/migrate.ts:46`) filters the contents of
> `supabase/migrations/` against the ledger, so a lineage naming only the baseline reports all
> 36 chain files pending and `001` aborts on an already-existing table. The baseline therefore
> records the chain it subsumes — the same claim `--baseline` mode writes for objects created
> by hand, earned by `npm run schema:equivalence`. (2) The original text said the checksum is
> "recorded the same way `scripts/migrate.ts` already records every other migration's
> checksum". It does not: `scripts/migrate.ts:329` inserts `filename` only, so every row the
> chain writes leaves `checksum` null. The checksum column exists **for the baseline**, and the
> subsumed rows deliberately carry none — only the baseline file's bytes were hashed.
> (3) `038` has since been authored and folded into the baseline, so the next new migration is
> `039`. See `docs/superpowers/specs/2026-09-01-greenfield-bootstrap-gap-design.md`.
No new tooling is needed for this item — it is a data-entry step (baseline SQL file → one
ledger row → checksum) exercised for real during the item 1.11 rehearsal below, not a design
decision requiring its own procedure.

## Rehearsal procedure (item 1.11 — the fresh-project bootstrap gate)

Run only once Neon resource creation is authorized and item 1.3's baseline + item 1.7's
equivalence tests exist:

1. Create a **disposable** Neon project (not the eventual `fimmick-aiso-v2-prod`).
2. Enable Neon Auth on its default branch — before anything else, per ADR-009's ordering
   requirement (`neon_auth.user` must exist before the baseline's `profiles` FK runs).
3. Run the baseline SQL via `MIGRATE_DATABASE_URL` against the disposable project's owner
   connection.
4. Run the equivalence manifest's diff checks against the disposable project.
5. Run `__tests__/migrations/rls-policy-freeze.test.mjs`-equivalent assertions against it:
   confirm no policy exists anywhere, confirm the seven zero-policy tables carry
   `rowsecurity = true`, confirm `aeo_app` has `rolbypassrls = true`.
6. Run the least-privilege role tests (`__tests__/integration/least-privilege-role.test.ts`'s
   pattern) against the disposable project's `aeo_app` role.
7. Tear down the disposable project.
8. Record the outcome (pass/fail, with the diff output) as the item 1.11 gate evidence —
   plan §19 names this as one of the two hard gates; nothing in Phase 2 onward starts before
   it passes.

## Harness parameterisation (item 0.8 — see its own task in this plan)

`__tests__/helpers/neon-branch.ts`'s `PROJECT_ID`/`PRODUCTION_BRANCH_ID` become
environment-injected rather than hardcoded, so the rehearsal above and the eventual real
project can both use the same harness without a code change between them. Implemented
separately in this plan's Task 8.

## Open items this document does not resolve

- The disposable project's exact AWS region (§24 decision 2 defers the literal region string
  to implementation time — a technical lookup, not a stakeholder decision).
- Whether the rehearsal's disposable project doubles as the eventual non-prod sterile-parent
  project (§24 decision 13) or is torn down and a separate one created — decide at item 1.2.
