# Implementation status

Updated **2026-09-10**.

    Phase:                 0 complete; 1 in progress
    Repository:            github.com/YNWAforever/aiso
    Branch:                claude/fimmick-aiso-phase-0-1-3cf312 (isolated worktree)
    Starting baseline SHA: 5bb2dcce11b63e027591e568786ff6e2c1577051 (clean tree)
    Current SHA:           379887c
    Uncommitted:           documentation only (this set)

## Completed

**Phase 0 preflight — done.** Repository, branch, HEAD and dirty state pinned;
capabilities mapped KEEP / FIX / EXTEND / BUILD / DEFER; the scan → claim → tenancy →
evidence → work → export path traced to real services and SQL; the scanner registry
and test baseline recorded; the v6 review opened in an authorised browser and its
source traceability verified. See `00-BASELINE-AND-GAPS.md`.

**Phase 1 slice 1 — landed (`379887c`).**

| Epic | What changed |
|---|---|
| P1-E1 trust | Claim intent made mandatory on both claim paths. It was verified only `if (token)`, so omitting the cookie skipped the check and any authenticated session could claim any unowned scan; `/api/onboarding/complete` was a second path that never checked it at all. Both now route through one predicate that treats an absent token as a denial. |
| P1-E1 trust | Two unguarded outbound fetches moved onto the SSRF-guarded fetcher: `app/api/fix` fetched a customer-supplied `scan.url` and fed the body into an LLM prompt; `lib/authority/layer2-signals` probed a caller-supplied hostname three times, once with `redirect: 'follow'`. |
| P1-E1 scan protection | `__tests__/checks/scan-compatibility-freeze.test.ts` pins the twenty check ids, buckets, weights, the 45/30/25 split, grade boundaries and pass/warn/fail scoring **by value**, and ties the TypeScript registry to migration 041's `check_key` constraint so the two cannot drift. |
| P1-E1 scan protection | `__tests__/security/no-unguarded-fetch.test.ts` replaces a hand-written eight-filename list with a directory walk over `lib/checks`, `lib/authority` and `app/api` — which is why the two live instances had gone unseen. |

## Verification

| Command | Exit | Result |
|---|---|---|
| `npm run typecheck` | 0 | clean |
| `npm run lint` | 0 | 0 errors, 0 warnings |
| `npm run test:unit` | 0 | **286 files / 3856 tests, 0 skipped** (baseline 284 / 3714) |
| `REQUIRE_INTEGRATION_TESTS=1 npm test` | — | **not run** — BLOCKED |
| `npm run e2e` | — | **not run** — BLOCKED |

Acceptance: **3 PASS, 8 PARTIAL, 3 BLOCKED, 1 DEFERRED, 0 FAIL** across AC-01…AC-15.
Full table with evidence in `04-ACCEPTANCE-MATRIX.md`.

## Migrations and flags

- No migration is needed to deploy `379887c`; it touches no schema.
- `040`–`043` remain **unapplied** to the AISO development database. `--verify`
  reports seven missing tables. Purely additive.
- No new feature flag added yet. Phase 1 will add `owner_home_v1`,
  `asset_sources_v1` and `recheck_compare_v1` to the union in `lib/flags.ts`.

## Production actions taken under existing authority

**None.** No deployment, no production migration, no billing change, no external
account connection, no outbound message, no customer-content write.

The only database interaction was read-only: `scripts/verify-db-connection.mjs` and
`npm run migrate -- --verify` / `--dry-run` against the AISO **development** project
(synthetic seed: 1 account, 2 clients, 1 scan).

## Blockers

1. **`npm run migrate` denied by the permission classifier.** Applying `040`–`043` to
   the development database is the single dependency for every remaining Phase 1
   slice — without those seven tables the owner loop has no schema to run against.
2. **Integration project not run.** `neonctl` 4.13.0 is installed and authenticated
   but prompts interactively for an organisation. Needs `NEON_API_KEY` exported, or an
   interactive shell.
3. **`eslint.config.mjs` protected** by the repo's `config-protection` hook, so the
   fetch rule could not be widened there. The equivalent invariant is enforced by the
   new test instead.

None of these blocks unrelated safe local work; they block *validation of the owner
loop*, which is why slices 4–10 are sequenced behind them.

## Next concrete action

Approve `npm run migrate` against the AISO development database
(`weathered-wave-50814522`, synthetic seed, not the Vercel-connected production
project). Four additive migrations, no destructive statements, each in its own
transaction, recorded in `schema_migrations`, reversible by leaving the unused tables
in place.

That unblocks, in order: slice 4 (recheck comparison adapter — the largest genuine
gap, designed in `01-DELIVERY-PLAN.md`§3), slice 5 (owner Home with three priorities
and one next action), slice 6 (approved source pack), slice 7 (export receipt),
slice 8 (separation of duties), slice 9 (agent-safety evaluation), slice 10
(telemetry, bilingual and mobile).
