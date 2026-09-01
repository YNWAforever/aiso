# Bootstrap the greenfield Neon project — design

**Status:** Approved 2026-09-02
**Phase:** 1. Covers items 1.2 (partial), 1.4, 1.9, and 1.11 — the Phase 1 gate.
**Target:** Neon project `weathered-wave-50814522` ("AISO"), `aws-ap-southeast-1`, created 2026-08-31.

## What is already true

Verified against the live project on 2026-09-02, not assumed:

| Fact | Evidence |
|---|---|
| The project exists and is named AISO | `neonctl projects list --org-id org-soft-sunset-25251479` |
| Neon Auth is enabled | `neon_auth` schema present, `neon_auth."user"` table present |
| It is empty | 0 tables in schema `public` |
| `aeo_app` does not exist | 0 rows in `pg_roles` for that name |
| The legacy `auth` schema is absent | 0 rows in `pg_namespace` |
| `.env.local`'s `DATABASE_URL` already points at it, as `neondb_owner` | `neon.project_id` GUC read in-band |

**Item 1.1 is therefore complete**, including its second half ("enable Auth on production
branch"). What has never happened is applying the baseline that Sub-project A spent its whole
effort proving correct.

A consequence worth stating plainly: local development currently points at that empty database,
which is why the app fails locally. That is a symptom of this same gap, not a separate defect.

## The constraint that shapes everything

`npm run schema:equivalence` **cannot be pointed at this project.** Migration `003` declares
`id uuid PRIMARY KEY REFERENCES auth.users(id)` (`supabase/migrations/003_phase3a_accounts.sql:15`),
and `scripts/schema-equivalence.mjs` never creates the legacy `auth` schema — it only drops and
recreates `public` (line 65), relying on branches of the production project *inheriting* `auth`.
AISO has no `auth` schema, so the equivalence runner's Path A would die at `003`.

That is not a problem to solve. Schema equivalence is a property of the two SQL paths and is
already proven on the production project. What AISO needs is the **bootstrap half only**:
baseline applies cleanly, and the runner then finds nothing pending.

## Design assumptions, adversarially audited

Before committing to this design, six auditors checked its load-bearing assumptions against
the actual files — portability, ledger behaviour, roles and grants, seed feasibility, safety
guards, and re-run recovery — and every finding was handed to a skeptic prompted to refute it.
One survived: the brand-limit trigger's effect on seed idempotency, folded into the seed
section below. The audit also confirmed the central premise, that the seedable subgraph never
reaches `profiles` or `neon_auth`.

## Approach

A dedicated `scripts/bootstrap-project.mjs` that installs a baseline onto one named target,
**rehearsed on a disposable branch of AISO and then run against its production branch using the
same code path**. A rehearsal that exercises different code proves nothing.

### Rejected alternatives

| Alternative | Why not |
|---|---|
| Apply the baseline by hand | No rehearsal, no repeatability, checksum substitution done manually, nothing to re-verify with later. Item 1.11 asks for a rehearsal specifically. |
| Add a `--bootstrap-only` mode to `scripts/schema-equivalence.mjs` | Its `assertDisposableTestBranch` exists precisely to refuse non-disposable branches, and AISO's production branch is exactly that. The two scripts want opposite safety postures: equivalence must refuse anything but a disposable branch; bootstrap must accept a named real branch and refuse a non-empty database. Merging them means weakening the guard least worth weakening. |

## Components

### 1. `scripts/bootstrap-project.mjs`

Applies `supabase/baseline/000_baseline_2026-08-31.sql` to one target, then verifies.

**Guards, in order, all fail closed:**

1. **Target named explicitly.** No default, ever. A defaulted target is how a stale environment
   variable reaches production.
2. **Identity reported and checked in band.** Read `neon.project_id` and `neon.branch_id` from
   the connection itself, print them, and refuse if either reads null — the same pattern
   `__tests__/helpers/neon-branch.ts` uses, and for the same reason: asking the connection what
   it is beats trusting what we meant to connect to.
3. **Refuse the production project outright**, by id, not by convention.
4. **Refuse if `public` contains any table.** An empty schema is the only state this script is
   safe to act on.

Errors pass through `redactSecrets` (`lib/security/redact-secrets.ts`); no connection string is
ever printed, on any path. The Neon driver embeds the full URL, password included, in some error
fields.

**Application** substitutes `:'baseline_checksum'` with the SHA-256 of the file's raw bytes,
exactly as `scripts/schema-equivalence.mjs:100-102` does. `.gitattributes` pins the file to LF so
the digest is platform-independent.

Applying is all-or-nothing: Postgres wraps a multi-statement simple Query in an implicit
transaction, proven empirically on 2026-09-01. A failure leaves nothing behind.

### 2. Verification, in the same run

- expected object counts present
- `aeo_app` exists, and has `BYPASSRLS`
- the `neon_auth` grants landed (guarded on schema existence; AISO has it)
- `migrate --dry-run` reports `Nothing to apply` — the same bootstrap proof already wired into
  the equivalence runner

### 3. `supabase/seeds/001_synthetic.sql`

`accounts → clients → scans`, fixed UUIDs, `on conflict do nothing`. **No `neon_auth` writes and
no seeded identity** — `profiles.id` carries a foreign key into `neon_auth."user"`, a schema Neon
owns and provisions, and hand-writing identity rows risks diverging from what the real signup
flow produces. Signing up through Neon Auth creates the profile via the existing `webhooks/neon`
handler. Every value synthetic; **no production data, ever**.

Required columns, read off the baseline rather than guessed:

| Table | Not-null without default | Foreign keys |
|---|---|---|
| `accounts` | *none* — `insert into accounts default values` is legal | none |
| `clients` | `account_id`, `brand_name` | `account_id` |
| `scans` | `url`, `domain`, `results` (jsonb) | — |

Confirmed: none of the three reaches `profiles` or `neon_auth."user"`.

#### The brand-limit trigger dictates the seed's shape

`clients` carries a `BEFORE INSERT` trigger, `enforce_brand_limit` (baseline `:2993-2996`),
calling `check_brand_limit()`. An account left at its defaults (`plan text not null default
'basic'` at `:88`, `status ... default 'active'` at `:92`, `stripe_subscription_id` NULL)
resolves through the CASE at `:2081-2087` to **`else 'free'`**, and `:2094-2095` caps both
`free` and `basic` at **one brand**.

Two consequences, both non-obvious:

1. **A paid plan alone is not enough.** `effective_plan` only reaches the stored plan when
   `status = 'active' AND stripe_subscription_id IS NOT NULL` (`:2077`, `:2082`). The seed
   account is therefore `plan='pro'`, `status='active'`, and a synthetic
   `stripe_subscription_id` — matching what `__tests__/integration/brand-creation.test.ts:19-23`
   already does. **Do not reach for `trial_ends_at` instead**: `check_brand_limit()` compares it
   to `pg_catalog.now()` (`:2078-2079`), so a hardcoded timestamp is a time bomb that starts
   failing after that date.

2. **`on conflict do nothing` does not make the client insert idempotent.** PostgreSQL fires
   `BEFORE INSERT` row triggers *before* the `ON CONFLICT` arbiter is evaluated, so on a second
   run the trigger counts the rows already present and raises `BRAND_LIMIT_REACHED` before the
   arbiter can skip the row. The invariant that makes re-runs safe is therefore:

   > **seeded clients per account must stay strictly below that account's effective brand limit.**

   With `plan='pro'` (limit 3) the seed creates **two** clients: a re-run counts 2, 2 < 3 passes
   the trigger, and `do nothing` then skips both rows. Adding a third seeded client under the
   same account would silently break re-runnability.

Reasoning is not proof, so **the rehearsal applies the seed twice** and requires the second run
to succeed. That turns this trigger/arbiter interaction from an argument into a measurement.

### 4. Handoff runbook

Deliberately not automated, because it involves credentials:

- `alter role aeo_app login password '<generated>'` — the baseline creates the role `NOLOGIN`
  on purpose, so no secret ever lands in a tracked file
- the Vercel environment bindings
- updating `.env.local` to connect as `aeo_app`

## Error handling

- Baseline application is atomic; a failure leaves the database untouched.
- Seeds run only if the baseline and its verification both succeeded.
- Every failure path names the target project and branch, so a wrong-target run is obvious in
  the output rather than silent.
- Rollback for a fresh project is `drop schema public cascade; create schema public;` — safe
  precisely because the guard proved the schema was empty before we touched it.

## Testing

Guard logic is written as pure functions with unit tests, so the dangerous decisions are testable
without a database. The disposable-branch rehearsal is the integration proof, and it runs before
anything touches AISO's production branch.

## Out of scope

- Production migration `038`'s release gate — blocked on credentials, which are not on this machine.
- Items 1.6 (connection-binding guards) and 1.8 (role allow/deny tests). 1.8's tests must connect
  *as* `aeo_app`, so they cannot run until someone sets its password.
- Touching the production project `red-firefly-93523049` in any way.
