## Static verification follow-up

- Replaced the CI test's CommonJS load with a standard import of the launcher helper.
- Kept the launcher CommonJS-executable and suppressed only `@typescript-eslint/no-require-imports` at file scope, with rationale.
- Updated the lint command to ignore all nested `.worktrees/**` artifacts while retaining the existing metadata and coverage exclusions.
- Fresh local verification: `npm.cmd run lint`, `npm.cmd run typecheck`, the two CI contract test files, and `git diff --check` were run after the change.
- GitHub Actions, browser acceptance, and live-provider checks were intentionally not run.

## Final local verification

- `npm.cmd run lint` passed with 0 errors and 19 pre-existing warnings.
- `npm.cmd run typecheck` passed.
- `npm.cmd test -- __tests__/ci/gate-scripts.test.ts __tests__/ci/pr-gate-workflow.test.ts --run` passed: 2 files, 15 tests.
- `git diff --check` passed.
