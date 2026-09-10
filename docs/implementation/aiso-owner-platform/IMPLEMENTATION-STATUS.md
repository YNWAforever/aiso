# Implementation status

Updated **2026-09-10**.

    Phase:                 0 complete; 1 in progress
    Repository:            github.com/YNWAforever/aiso
    Branch:                claude/fimmick-aiso-phase-0-1-3cf312 (isolated worktree)
    Starting baseline SHA: 5bb2dcce11b63e027591e568786ff6e2c1577051 (clean tree)
    Current SHA:           8de8462 (pull request #21)
    Uncommitted:           documentation only (this set)

## Completed

**Phase 0 preflight — done.** Repository, branch, HEAD and dirty state pinned;
capabilities mapped KEEP / FIX / EXTEND / BUILD / DEFER; the scan → claim → tenancy →
evidence → work → export path traced to real services and SQL; the scanner registry
and test baseline recorded; the v6 review opened in an authorised browser and its
source traceability verified. See `00-BASELINE-AND-GAPS.md`.

**Phase 1 slices 1, 4 and 5 — landed.**

| Epic | What changed |
|---|---|
| P1-E1 trust | Claim intent made mandatory on both claim paths. It was verified only `if (token)`, so omitting the cookie skipped the check and any authenticated session could claim any unowned scan; `/api/onboarding/complete` was a second path that never checked it at all. Both now route through one predicate that treats an absent token as a denial. |
| P1-E1 trust | Two unguarded outbound fetches moved onto the SSRF-guarded fetcher: `app/api/fix` fetched a customer-supplied `scan.url` and fed the body into an LLM prompt; `lib/authority/layer2-signals` probed a caller-supplied hostname three times, once with `redirect: 'follow'`. |
| P1-E1 scan protection | `__tests__/checks/scan-compatibility-freeze.test.ts` pins the twenty check ids, buckets, weights, the 45/30/25 split, grade boundaries and pass/warn/fail scoring **by value**, and ties the TypeScript registry to migration 041's `check_key` constraint so the two cannot drift. |
| P1-E1 scan protection | `__tests__/security/no-unguarded-fetch.test.ts` replaces a hand-written eight-filename list with a directory walk over `lib/checks`, `lib/authority` and `app/api` — which is why the two live instances had gone unseen. |
| P1-E5 recheck (`b80e52f`) | `compareScanChecks()` gives the product its first comparable technical recheck. `compareScanEvidence()` could never return `comparable: true`; page identity is now proven without storing a path, by requiring both runs' `final` descriptor to have redacted nothing. Emits `comparison_status` and per-check `outcome` in the brief's vocabulary. Content hashes are never compared. |
| P1-E2 owner Home (`2be46c2`) | Home leads with at most three priorities and one named next action, ranked by points still at stake. Ranking reads the evidence envelope rather than the verdict, so a check that could not be observed becomes a stated gap instead of invented work, and a pre-envelope scan reports `unavailable` rather than falling back to raw verdicts. Specialist panels preserved below. |

## Verification

| Command | Exit | Result |
|---|---|---|
| `npm run typecheck` | 0 | clean |
| `npm run lint` | 0 | 0 errors, 0 warnings |
| `npm run test:unit` | 0 | **289 files / 3901 tests, 0 skipped** (baseline 284 / 3714) |
| `npm test` | 0 | unit as above **plus 10 integration files / 71 tests**, against a disposable Neon branch that was provisioned, migrated through all 41 files and deleted. No skip banner printed. |
| five owner-loop integration configs | 0 | **5 files / 109 tests passed** on a separately provisioned disposable branch with 040–043 applied — composite-FK tenancy, append-only GRANT posture, and the app role's inability to UPDATE or DELETE history |
| CI `PR gate` (#21) | success | all 10 jobs: `static`, `unit-contract`, `integration`, `e2e-accessibility` ×4, `build`, `cloudflare-worker`, `pr-gate` |
| `npm run e2e` locally | — | not run. CI runs it, but under `E2E_FIXTURE_MODE` against a fixture DSN, so no authenticated owner journey is exercised anywhere yet |

Acceptance: **3 PASS, 9 PARTIAL, 2 BLOCKED, 1 DEFERRED, 0 FAIL** across AC-01…AC-15.
Four rows moved this session: AC-01, AC-03, AC-10 and AC-15.
Full table with evidence in `04-ACCEPTANCE-MATRIX.md`.

## Migrations and flags

- No migration is needed to deploy any commit on this branch; none touches a schema.
- `040`–`043` were **applied to the AISO development database on 2026-09-10, under
  explicit approval** — see "Production actions" below. `--verify` now reports all
  four `all present recorded`, and the ledger moved from 38 to 42.
- **No feature flag was added.** Both new surfaces are safe unflagged: the Home
  priorities section degrades to an honest `unavailable` state for any scan
  without an evidence envelope, and `compareScanChecks` has no caller in a
  request path yet. A flag would gate nothing that is not already fail-safe.
  `recheck_compare_v1` becomes necessary when the adapter is wired into
  `lib/outcomes`, since that changes a stored contract's output.

## Actions taken under explicit authority

**One, approved by the user in session:** `npm run migrate` applied `040`–`043` to
the AISO **development** database (`weathered-wave-50814522`, branch
`br-square-mountain-az6f82vi`, synthetic seed — *not* the Vercel-connected
production project). Four additive migrations, no destructive statements, each in
its own transaction. Confirmed by `--dry-run` beforehand and `--verify` afterwards;
the ledger moved 38 → 42 and the seed is intact (1 account, 2 clients).

The branch was also pushed and pull request #21 opened, likewise on approval.

**Still none of:** deployment, production migration, billing change, external
account connection, outbound message, customer-content write.

Against the persistent AISO **development** database (synthetic seed: 1 account,
2 clients, 1 scan) every interaction was **read-only**: `scripts/verify-db-connection.mjs`
and `npm run migrate -- --verify` / `--dry-run`.

Three **disposable** Neon branches were created and deleted in the same project, to
run the integration suites: one by `npm test`'s own harness, two by hand for the
owner-loop configs. Each was removed at the end of its run (`CLEANUP_OK`), and each
schema-reset asserted the branch's identity in band — via `neon.branch_id` on the
same session that ran the statement — before touching anything.

## Blockers

1. ~~`npm run migrate` denied by the permission classifier.~~ **Resolved** — approved
   and applied. The seven owner-loop tables now exist on the development database, so
   slices 6–10 and the E2E journey are unblocked.
2. ~~Integration project not run.~~ **Resolved this session** — `npm test` ran it end
   to end. `neonctl` only prompts interactively when invoked without `NEON_API_KEY`.
   A new finding replaces it: the five suites that prove the owner-loop schema are
   excluded from `vitest.integration.config.ts`, wired into no npm script and no CI
   job, and **skip silently with exit 0** when unconfigured — 109 tests reading as
   success while asserting nothing. They pass when given a target; the gate around
   them does not exist. See `04-ACCEPTANCE-MATRIX.md`§5.
3. **`eslint.config.mjs` protected** by the repo's `config-protection` hook, so the
   fetch rule could not be widened there. The equivalent invariant is enforced by the
   new test instead.

Only the third remains open, and it is cosmetic: the invariant it would enforce is
already enforced by `__tests__/security/no-unguarded-fetch.test.ts`.

## Next concrete action

The migration blocker is cleared, so the next slice needs no further authority.

**Slice 4b — wire the comparison adapter through `lib/outcomes`.** This is the one
that turns a library capability into something an owner sees. It is deliberately
sequenced first because `lib/outcomes/dto.ts` re-runs `evaluateOutcomes()` and
compares field by field, so a new window field has to land in five places at once —
`types.ts`, `evaluate.ts`, the DTO's key list and validator, the UI, and both message
catalogues — and `OUTCOME_REASON_CODES` is a closed vocabulary where every entry
needs localised copy. It also wants the `recheck_compare_v1` flag, because unlike the
two surfaces shipped here it changes a stored contract's output.

Then, in order: the approved source pack (slice 6, needs migration `044`), the export
receipt (slice 7, needs `045`), separation of duties (slice 8), the minimum
agent-safety evaluation (slice 9), and the telemetry, bilingual and mobile
verification that needs a real journey to walk (slice 10).

Worth doing early and cheaply, independent of all of the above: make the five
owner-loop integration configs reachable from `npm test`, or at minimum make an
unconfigured run fail rather than skip. 109 tests currently read as success while
asserting nothing.
