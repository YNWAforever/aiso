# Least-Privilege Database Role — Design

**Date:** 2026-08-16
**Status:** approved, not yet planned
**Depends on:** migration `036` (dropped the dead RLS policies) — applied to production 2026-08-16

---

## Why now

The app connects to Neon as `neondb_owner`, which is `rolbypassrls = true`, `rolcreaterole = true`,
and owns every object in `public`. A leaked application credential can therefore drop any table,
alter any schema, create new roles, and read anything — the credential *is* the database.

This was named as the durable fix for blast radius in
`docs/superpowers/plans/2026-08-15-rotate-neon-credential.md`, and deferred there for one specific
reason: introducing a non-owner role would have activated 30 dead Supabase-era RLS policies calling
`auth.uid()`, silently returning zero rows almost everywhere. **Migration `036` removed those
policies**, so that blocker is gone.

### Verified state (production, 2026-08-16)

| Fact | Value |
|---|---|
| Login roles | `neondb_owner` (bypassrls), `neon_auth` (**no** bypassrls), `neon_service`, `cloud_admin` |
| Roles holding table grants in `public` | **`neondb_owner` only**, on all 34 tables |
| Tables with a NULL ACL (owner-only) | 27 of 34 |
| Policies in `public` | 0 |
| Tables with RLS enabled | 7 (deliberate default-deny) |
| Tables with FORCE ROW LEVEL SECURITY | 0 |
| Runtime DDL outside `scripts/` | none |

Two things follow. First, a new role starts with **zero** access — every grant must be explicit.
Second, `neon_auth` already exists as a non-owner login role, so non-owner logins demonstrably work
on this Neon project.

---

## Goal

The running application connects as a role that cannot perform DDL, cannot create roles, and cannot
reach schemas it does not need. Migrations continue to run as the owner.

## Non-goals — each decided deliberately

**The new role keeps `BYPASSRLS`.** This is a *grants* change, not an RLS change.

Seven tables have RLS enabled with zero policies — `account_report_branding`,
`authenticated_scan_monthly_usage`, `client_report_versions`, `client_reports`,
`public_scan_rate_limits`, `stripe_subscription_processing_leases`, `stripe_webhook_events` — a
deliberate default-deny posture chosen by the migrations that created them (`023`, `024`, `025`,
`027`) and pinned by `__tests__/db/client-report-migration.test.ts`.

**Five of those seven are read or written at runtime.** Granting a `NOBYPASSRLS` role `SELECT` on
`client_reports` yields **zero rows, silently** — RLS on, no policy to match. That is precisely the
failure mode `036` existed to eliminate, reintroduced through a different door. Keeping `BYPASSRLS`
avoids it entirely while still delivering the blast-radius win, and leaves default-deny intact
against any *other* future role.

**This does not rotate the leaked `neondb_owner` password.** That credential is still live, still
exposed, and still separately owed. This work reduces what the *application* credential can do; it
does not retire the owner credential. Bundling them would make it harder to confirm either landed —
the same reasoning `2026-08-15-rotate-neon-credential.md` gives for not bundling the n8n JWT.

**No per-table grant tightening.** See below.

---

## Architecture

### Two roles

| Role | Used by | Rights |
|---|---|---|
| `neondb_owner` | `scripts/migrate.ts` only | unchanged |
| `aeo_app` (new) | the running application | `USAGE` on schema `public`; `SELECT, INSERT, UPDATE, DELETE` on all tables in `public`; `USAGE, SELECT` on all sequences. Nothing else. |

`aeo_app` gets no `CREATE` on any schema, no rights on `auth` or `neon_auth`, no `CREATEROLE`, and
no ownership. A compromised app credential can read and write application data — which the app can
do anyway, so this matches the real trust boundary — but cannot destroy or restructure the database,
escalate to a new role, or reach Neon Auth's tables.

### Blanket DML, not per-table

`GRANT … ON ALL TABLES IN SCHEMA public` rather than a per-table audit of which verbs each table
needs. Per-table grants are genuinely tighter, but they are the bulk of the work, need re-auditing
whenever a query changes, and a missed grant is a production 500. The blanket grant captures the
entire blast-radius win in one reviewable migration with no such risk. Tightening later remains
possible and is not blocked by anything here.

### `ALTER DEFAULT PRIVILEGES` is not optional

Without it, the *next* migration creates a table `aeo_app` cannot read, and the failure appears at
runtime in whichever route touches it first — long after the migration looked successful. `037`
therefore sets default privileges for objects created by `neondb_owner` in `public`, so future
tables and sequences are granted automatically.

This is the single most likely way this design silently rots. The verification below tests it
directly.

### Role creation: `NOLOGIN` in the migration, password out of band

`037` runs `CREATE ROLE aeo_app NOLOGIN` (idempotent, guarded on `to_regrole`) plus all grants. A
human then runs `ALTER ROLE aeo_app LOGIN PASSWORD …` separately, so no password ever enters git —
the same discipline that made the current leak worth fixing rather than repeating it in a migration
file.

### Two connection strings

`lib/db.ts` is unchanged: it reads `DATABASE_URL`, which becomes `aeo_app`'s DSN.

`scripts/migrate.ts` changes to read a new **`MIGRATE_DATABASE_URL`** and **fail loudly when it is
unset** — no fallback to `DATABASE_URL`. A fallback would run migrations as the app role, fail
partway through the first DDL statement, and leave the operator guessing; failing at startup with a
clear message is strictly better. `.env.example` documents both.

---

## Verification

The existing integration harness already provisions disposable Neon branches and replays every
migration. The new suite runs there, connecting **as `aeo_app`** rather than as the owner, and
asserts both directions:

**Positive** — the app role can do its job:
- `SELECT`, `INSERT`, `UPDATE`, `DELETE` on a representative table succeed
- the 7 default-deny tables return **real rows, not zero** — the specific regression this design
  exists to avoid, and the reason `BYPASSRLS` is retained
- a table created by a migration applied *after* the grants is readable, proving
  `ALTER DEFAULT PRIVILEGES` works

**Negative** — asserting the privilege is actually absent is the whole point, so each must raise:
- `CREATE TABLE`, `DROP TABLE`, `ALTER TABLE`
- `CREATE ROLE`
- reading a `neon_auth` table

A test that only proves the role *works* would pass just as happily against `neondb_owner` and
prove nothing about least privilege.

**Static** — a unit test pinning that `scripts/migrate.ts` reads `MIGRATE_DATABASE_URL` and does not
fall back to `DATABASE_URL`, so the fallback cannot be reintroduced by a later refactor.

---

## Cutover

Runbook only. A human executes it, as with `036` and the credential rotation.

1. Apply `037` (creates the role `NOLOGIN`, with grants).
2. Set the password out of band; never paste the DSN into a shell command — the driver echoes the
   full URL including the password in its error messages.
3. Set `MIGRATE_DATABASE_URL` (owner DSN) locally and anywhere migrations run.
4. Set `DATABASE_URL` to the `aeo_app` DSN in each Vercel environment, then redeploy.
5. Verify: a scan, a dashboard load, a report read, and a Stripe webhook replay.
6. Rollback is a single env-var swap back to the owner DSN — keep it to hand until step 5 passes.

Do not run any of this against production while building the change.

---

## Risks

| Risk | Handling |
|---|---|
| A future migration creates an ungranted table | `ALTER DEFAULT PRIVILEGES`, tested directly |
| A missed grant breaks a route | Blanket DML makes it unlikely; failures are loud 500s, not wrong answers; branch verification catches it first |
| Someone reintroduces the `DATABASE_URL` fallback in `migrate.ts` | Static test pins it |
| A future role is added without `BYPASSRLS` and hits the 7 default-deny tables | Documented in `CLAUDE.md`; out of scope to prevent mechanically |
| Neon's pooler rejects a SQL-created role | `neon_auth` is already a non-owner login role here, so this is expected to work — but the plan's first verification step must confirm it on a branch before anything else is built on it |

---

## What this deliberately does not do

- **Rotate the `neondb_owner` password.** Still owed, still separate.
- **Make RLS load-bearing.** No policies are created; the `create policy` ban added alongside `036`
  stands.
- **Reverse `027`'s default-deny posture** on the 7 tables.
- **Tighten grants per table.** Possible later; not blocked by this.
- **Change `lib/db.ts` or any query.** Only `scripts/migrate.ts` changes.
