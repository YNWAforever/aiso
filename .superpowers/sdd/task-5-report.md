# Task 5 report — anonymous scan ownership and onboarding continuity

## Status

Implemented on `codex/scan-to-signup-impl`.

## Changes

- Added an idempotent `claimScanForAccount` flow with explicit missing, conflict, same-owner, claimed, and persistence-error states.
- Kept the ownership transition to one guarded update using both scan ID equality and `account_id IS NULL`; a no-row race is re-read before returning a deterministic result.
- Switched onboarding completion to the existing Neon profile and claims/checks the supplied scan before trial/client work or the existing-client early return.
- Included `scanId` in existing-client and new-client responses.
- Started complete scan prefills at onboarding step 3 and routed completion directly to the existing dashboard report without calling `/api/scan` again.
- Added visible localized labels, stable form names, and desktop-only programmatic focus after step transitions; removed mobile `autoFocus`.
- Sanitized repeated/empty onboarding scan query parameters.

## Verification

- `npm.cmd test -- --run __tests__/api/scan-claim.test.ts __tests__/api/onboarding-flow.test.ts __tests__/api/onboarding.test.ts` — PASS, 20/20 tests.
- `npm.cmd run lint` — PASS, 0 errors; 42 pre-existing warnings remain, including duplicated warnings under the existing `.worktrees/scan-to-signup` tree.
- `npx.cmd tsc --noEmit` — PASS.
- `npm.cmd run build` with process-local non-production `NEON_AUTH_COOKIE_SECRET` — PASS; Next.js compiled, typechecked, and generated 20/20 static pages.
- `git diff --check` — PASS.

## Concerns / known environment output

- E2E was not run because the task permits it to remain blocked by unavailable Neon/Supabase fixtures; no secrets were pulled or bypassed.
- Build retained baseline warnings about multiple lockfiles/workspace-root inference and a caught Neon Auth dynamic-server diagnostic for `/admin`; the build exited successfully.
- No schema, RLS, grant, service-key, ACL, pricing, or Task 6 changes were made.

---

# Task 5: Pull-request merge gate

## Changes

- Added `.github/workflows/pr-gate.yml` with read-only pull-request and manual triggers, constrained concurrency, four bounded fixture-only validation jobs, and an always-running aggregate gate.
- Added a workflow contract test covering trigger safety, job dependencies, Node 24 setup, required checks, fixture environment, action versions, and diagnostic uploads.
- Reused the existing fail-closed aggregate script: every dependency result other than `success`, any missing required summary, or any failed/skipped summary blocks the gate.

## Verification

- `npm.cmd test -- __tests__/ci/pr-gate-workflow.test.ts --run` passed: 1 file, 1 test.
- `npm.cmd test -- __tests__/ci/gate-scripts.test.ts --run` passed: 1 file, 14 tests.
- `npm.cmd run typecheck` passed.
- `git diff --check` passed.

## Residual environment blockers

- No GitHub Actions run was triggered or observed locally; real runner, Playwright dependency-installation, and artifact evidence remain pending GitHub-hosted execution.

## Fix follow-up: preserve E2E diagnostics

- Changed the E2E invocation to one supported multi-reporter option: `--reporter=html,json,junit`, preserving the existing HTML, JSON, JUnit, artifact, fixture-only environment, `if: always()`, and failure-propagation behavior.
- Strengthened the workflow contract to require that exact multi-reporter command. Local workflow contract test, gate-script test, typecheck, and diff check passed; GitHub Actions/Playwright browser execution remains intentionally unrun.
