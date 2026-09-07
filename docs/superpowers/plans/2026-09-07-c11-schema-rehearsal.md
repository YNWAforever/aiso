# Isolated AISO schema-equivalence rehearsal proposal

Prepared 2026-09-07. Status: PREPARED ONLY; live execution requires separate approval.

## Pinned source and review

Application/tooling source: 5876d2498abc3a708339d5125bbbd7df6ae3de53; tooling repair commit 9aaf413. Documentation added afterward does not change the runner. Runner SHA256:84C9425F6085DC9275A244D14CC3EEDF39E3F9EFF188AFFA72F44CB48346A95B.

Review the exact tooling delta with `git show 9aaf413 -- scripts/schema-equivalence.mjs __tests__/scripts/schema-equivalence.test.mjs`. Both schema paths now reach the migration head, the existing integration auth shim is emitted after identity checks, and failed dry-run output cannot count as success. Independent review approved this diff. On 2026-09-07 all44 mocked schema-equivalence/bootstrap/baseline-guard tests passed again. They do not establish live equivalence.

## Exact target and scope

- Neon project: weathered-wave-50814522 (AISO).
- Expected default/parent: br-square-mountain-az6f82vi, previously confirmed by the user to contain synthetic data only. Recheck that status and default identity before execution.
- Create exactly one NEW child named by the pinned runner: equiv-<process-id>-<timestamp>-<8-character UUID>. Record its returned ID; never substitute an existing branch.
- Expected database: neondb; migration owner: neondb_owner. The helper selects the role explicitly but lets neonctl select its default database. Verify the project database inventory before running; stop if it is ambiguous or the default differs.
- Child expires after two hours; cleanup attempts deletion in finally. Branch creation/compute may consume Neon quota. No AI requests, scans, email, application deployment or customer writes are included.
- Retained C9 proof branch br-hidden-hill-az61ux9z and the parent are excluded from reset, migration and deletion.

The helper does not pass --parent and only checks that the created branch has a parent_id; it does not enforce that parent_id equals the expected parent. Consequently a default-parent change between preflight and creation is not rejected by this source. A live run must remain blocked if stable synthetic-parent selection cannot be established; prepare a separately reviewed explicit-parent guard before execution if needed. The production-branch environment variable is a rejection guard, NOT a parent selector.

## Preflight and execution recipe

Before seeking execution approval, read the project's current default branch, database/role inventory and synthetic-only ownership evidence without retrieving or printing credential values. Confirm Node24, authenticated neonctl, clean checkout and pinned file hashes. Stop on identity or source drift. This preparation has not refreshed Neon metadata or obtained credentials.

Credentials: use an existing authenticated neonctl session or NEON_API_KEY from the approved AISO credential source. Never put a key or database URL in the command, document or transcript. The runner obtains the created child connection URI in memory. Do not load production .env.local or use the fixture-only local-run.cjs wrapper for the live command.

Proposed PowerShell process environment and command, NOT executed:

```powershell
$env:NEON_TEST_PROJECT_ID = 'weathered-wave-50814522'
$env:NEON_TEST_PRODUCTION_BRANCH_ID = 'br-square-mountain-az6f82vi'
$env:NEON_TEST_OWNER_ROLE = 'neondb_owner'
node scripts/schema-equivalence.mjs
```

Run only from this reviewed checkout in a fresh process, with the approved credential source. The runner creates the child, proves the child/session identity, drops/recreates public, prepares legacy auth prerequisites, and applies all checked-in migration files through043. It introspects path A, then resets public again, loads the checked-in baseline and advances remaining migrations through043 for path B. It compares application-owned schema classes and requires a successful dry-run with nothing pending. The legacy auth shim is distinct from Neon Auth-owned objects; do not claim authentication equivalence from this comparison.

The adjacent JSON manifest pins SHA256 for every migration and the baseline. The migration sequence is the existing on-disk sequence, including historical numbering gaps; do not invent missing migration files or change SQL to force equivalence.

## Acceptance and evidence

Require all of: recorded exact child identity and TTL, expected parent/database/owner, both paths reaching the pinned head, zero schema differences, successful bootstrap dry-run, exit0, and independent control-plane confirmation that the exact created child was deleted. Store sanitized per-class output and timings, source/manifest hashes, ledger evidence available from the runner, and cleanup readback. A successful exit alone is insufficient: deletion errors are logged but do not reliably change the exit code. Do not claim tenant/auth/provider acceptance from schema equivalence.

On divergence, preserve the sanitized report and diagnose locally. Do not patch schemas, widen migration scope or repeat paid/provider operations automatically. A failed rehearsal remains a release blocker.

## Cleanup / rollback / abort

The only rollback is deleting the newly created child; no parent migration is performed. The runner automatically attempts registered-child deletion even after failure. If deletion fails, inspect that exact ID and expiry; only delete it after proving it is this run's nondefault child. Never clean up by name prefix or delete the retained C9 proof branch. A crash can leave a child until its two-hour TTL. Confirm eventual deletion rather than assuming expiry succeeded.

Abort before mutation on changed default parent, ambiguous database, customer data, wrong project/role, hash mismatch or missing authentication. If creation returns an unproven identity, the helper refuses automatic cleanup: perform read-only inventory and request a precise cleanup decision. Execution approval must cover one child creation, its two public resets, migrations/baseline replay, legacy auth shim and deletion of that same child. Preparation and PR publication do not grant that approval.
