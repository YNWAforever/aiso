# Greenfield baseline, provable — design

**Status:** Approved 2026-08-31
**Governs:** base plan items 1.7 (equivalence manifest), 1.3 (schema-only baseline), 1.5
(migration ledger + checksum) — "Sub-project A" of Phase 1
**Depends on:** ADR-007 (Accepted), `docs/plans/2026-08-31-greenfield-neon-baseline.md`
(the authoring checklist this design makes executable)

## Scope

Phase 1's eleven items split by whether they create real, billed Neon infrastructure. The
stakeholder authorized the **code-only** half. This design covers three of those six items —
the ones forming one coherent deliverable: *a baseline SQL file we can prove is equivalent to
the migration chain.*

- **In scope:** 1.7, 1.3, 1.5.
- **Deferred to Sub-project B:** 1.6 (connection binding guards), 1.8 (role allow/deny
  tests), 1.9 (synthetic seeds). Independent of this work, smaller.
- **Still unauthorized:** 1.1, 1.2, 1.10, 1.11 — every item that creates a *new* Neon project
  or persistent resource. `NEON_API_KEY` being provisioned for CI does not change this.

## Dependency inversion vs. the base plan

The base plan orders 1.3 → 1.7 (author the baseline, then prove it). This design **inverts
that**: build the differ first, then author the baseline against it.

Rationale: approach C ("author by hand, diff continuously") is the whole point. A baseline
authored blind and verified once at the end surfaces a single enormous diff with no signal
about which of 35 migrations was mistranscribed. Authoring in slices against a working differ
turns that into six small, immediately-attributable diffs. The verifier is a prerequisite,
not a follow-up.

## Two constraints discovered in the existing harness

Both come from reading `__tests__/integration/setup.ts` and
`__tests__/helpers/neon-branch.ts`, and both shape the architecture:

1. **`drop schema public cascade` can only run in the process that created the branch.**
   `assertDisposableTestBranch()` validates against a module-private `created` map that only a
   successful in-process `createTestBranch()` populates. Vitest test workers get their own
   empty copy and *therefore cannot satisfy the guard at all* — this is a deliberate safety
   property, documented in that file. **Consequence:** the two-path comparison cannot live in
   a test worker. It lives in a single-process script.
2. **The `auth` schema is asymmetric between the two paths.** Legacy-to-head requires it —
   migration `003` FKs `auth.users` and calls `auth.uid()`. The greenfield baseline
   deliberately does *not* recreate it (plan §15.2: remove transitional Supabase dependencies
   from the greenfield path entirely). **Consequence:** the diff scopes to `public` only.
   Comparing `auth` would report a guaranteed false failure.

## Architecture

Four units, each with one responsibility and a well-defined interface:

| Unit | File | Responsibility | Verified by |
|---|---|---|---|
| Differ | `lib/schema/diff.ts` | Pure `diffSchemas(a, b) → SchemaDiff`. No I/O, no DB. | Unit tests, TDD |
| Introspector | `lib/schema/introspect.ts` | Catalog queries → `SchemaSnapshot`. Thin, no branching logic. | The runner, against real Postgres |
| Runner | `scripts/schema-equivalence.mjs` | Provision branch, build both paths, diff, report, exit 0/1 | Run against real Neon |
| Baseline | `supabase/baseline/000_baseline_2026-08-31.sql` | The consolidated schema | The runner |

The differ/introspector split is what makes this testable: **all comparison logic is pure and
unit-testable against fixtures**, while the database-touching part stays thin enough that its
correctness is evident from the runner's output.

### Runner flow

Single process throughout, so the provenance registry is satisfied:

```
createTestBranch()                       ← existing project, disposable, 2h TTL
  reset public → migrate 001–037  → introspect → snapshot A   (legacy-to-head)
  reset public → apply 000_baseline → introspect → snapshot B (baseline-to-head)
  diffSchemas(A, B) → human-readable report → exit 0 (equivalent) / 1 (divergent)
finally: deleteTestBranch()
```

Resetting between paths keeps this to one branch per invocation rather than two.

### Diff coverage

Eight object classes. Seven come from the manifest in
`docs/plans/2026-08-31-greenfield-neon-baseline.md`; **triggers** were added after a code
review caught them as a real gap — `clients`'s `enforce_brand_limit` trigger (defined `011`,
redefined `026`/`028`) lives in `pg_trigger`, a different catalog from the function it calls,
so a `pg_proc`-only diff would report success while brand-limit enforcement silently vanished.

| Class | Source | Note |
|---|---|---|
| Tables + columns | `information_schema.columns` | name, type, nullability, default |
| Constraints | `information_schema.table_constraints` + `pg_get_constraintdef` | **bodies, not just presence** — two differently-worded `check(...)` predicates must not compare equal |
| Indexes | `pg_indexes` | full `indexdef` |
| Triggers | `pg_trigger` | presence **and** the function each one calls |
| Functions | `pg_proc` | application-owned schemas only |
| Grants | `information_schema.role_table_grants` | `aeo_app` only |
| RLS posture | `pg_tables.rowsecurity` + `pg_policies` | all 34 tables; policy count must stay zero |
| Extensions | `pg_extension` | `pgcrypto` in `public`, created by `027` |

**Excluded deliberately:** `auth` (asymmetric, see above), `neon_auth` (Neon-managed,
inherited identically by both paths, and the baseline must never create or own it).

## Baseline authoring: six slices

Consolidated from 35 files / 2,778 lines / 34 tables / 29 indexes / 16 functions / 4
triggers. Each slice ends with a differ run, so a transcription error is attributed to the
slice that introduced it:

1. **Core tenancy** — `accounts`, `profiles`, `clients`
2. **Scan engine** — `scans`, `fix_packs`, `chunk_analysis`
3. **Monitoring** — `prompt_bank`, `pulse_metrics`, `pulse_weekly_summary`, `alert_configs`,
   `notifications`, `alert_email_deliveries`
4. **Features** — `client_reports`, `client_report_versions`, `account_report_branding`,
   `local_trust_*`, `authority_*`, `domain_signals`, `agent_*`
5. **Infra + packs** — `public_scan_rate_limits`, `authenticated_scan_monthly_usage`,
   `stripe_webhook_events`, `stripe_subscription_processing_leases`, `industry_packs`,
   `regional_packs`, `topical_clusters`, `content_briefs`, `ai_citation_log`
6. **The `037` layer** — functions, triggers, roles, grants, `BYPASSRLS`, RLS posture

Slices 1–5 will each show an expected, shrinking diff (later slices' tables still missing);
only after slice 6 must the diff be empty. The runner reports per-class counts so partial
progress is legible.

Authoring rules, from ADR-007 and plan §15.2:
- Author from migration source, reviewed line by line. **Never** `pg_dump` production.
- Exclude the dead `auth` schema and the 30 policies `036` already dropped.
- Preserve `aeo_app`'s exact grant set and its `BYPASSRLS` flag; preserve the seven
  RLS-enabled/zero-policy tables' posture, each per its *creating* migration (`023`, `024`,
  `025`, `027`).

## Migration ledger (1.5)

`schema_migrations` in a greenfield project starts with a single row naming the baseline file
plus an immutable checksum of its contents, recorded the same way `scripts/migrate.ts` already
records every other migration. Both existing guards are preserved unchanged, not
reimplemented: the runner refuses a populated database with an empty ledger, and `--baseline`
refuses to record a migration whose tables are missing. Future migrations continue from `038`.

## Error handling

- **Branch provisioning fails** → the runner exits non-zero having created nothing; existing
  `cleanupCreatedBranches()` semantics apply.
- **A migration or the baseline fails to apply** → surface the SQL error verbatim, then still
  delete the branch in `finally`. A failed apply is the expected outcome while authoring.
- **Diff is non-empty** → exit 1 with a per-class report. This is the normal signal during
  slices 1–5, not a crash.
- **Secrets** → the runner must never print a connection string; `@neondatabase/serverless`
  echoes full URLs including passwords in error messages, so output is piped through the
  existing `scripts/redact.mjs`, matching what `scripts/neon` and the CI integration job
  already do.

## Testing

- `lib/schema/diff.ts` — unit tests, written first (TDD). Fixtures cover: identical
  snapshots; a missing table; a column type change; a check-constraint whose *body* differs
  but whose name matches; a trigger present in one path only; a grant difference; a policy
  appearing where none should exist.
- `lib/schema/introspect.ts` — no unit tests; it is thin catalog SQL whose correctness is
  demonstrated by the runner producing a diff that converges to empty.
- The runner — exercised manually during authoring; wiring it into CI belongs to item 1.11,
  which is not authorized yet.

## Out of scope

Creating any new Neon project, branch topology, Vercel binding, or preview-branch lifecycle
(items 1.1, 1.2, 1.10). Running the 1.11 bootstrap-rehearsal gate. Sub-project B's guards,
role tests, and seeds. Any change to the existing `001`–`037` chain, which stays intact as the
old project's lineage per ADR-007.
