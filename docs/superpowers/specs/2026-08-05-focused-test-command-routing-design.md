# Focused Test Command Routing Design

**Status:** Approved design, 2026-08-05

## Goal

Make `npm test -- <paths>` a reliable focused gate while preserving the existing full-suite contract: `npm test` with no arguments must run the unit suite and the Neon-backed integration suite in sequence.

## Root cause

The current `package.json` script is:

```text
vitest run --exclude '__tests__/integration/**' && vitest run --config vitest.integration.config.ts
```

When npm appends file arguments after `--`, it appends them to the final command in the shell chain. A focused unit command therefore runs the requested files once in the unit runner and then passes those same files to the integration-only runner. The integration runner has no matching files and exits with `No test files found`, even though the focused unit tests passed.

This is deterministic and reproducible on the release candidate `2a3dd42`; it is not a Neon or test-data failure.

## Chosen approach

Add a small cross-platform Node dispatcher at `scripts/run-tests.mjs` and point only the `test` package script at it. Keep these existing scripts unchanged:

```json
"test:unit": "vitest run --exclude '__tests__/integration/**'",
"test:integration": "vitest run --config vitest.integration.config.ts"
```

The dispatcher classifies command-line arguments after npm's `--` separator:

| Input | Runner(s) | Arguments |
| --- | --- | --- |
| no arguments | unit, then integration | all runner defaults |
| unit paths only | unit | shared flags and unit paths |
| integration paths only | integration | shared flags and integration paths |
| mixed paths | unit, then integration | each runner receives shared flags plus its own paths |

An argument beginning with `-` is a shared Vitest flag. A path containing `__tests__/integration/` (with either slash style) is an integration path; other non-flag paths are unit paths. The dispatcher runs the selected runners serially and exits on the first non-zero status. It must use the local Vitest executable and inherit stdio so existing output and exit codes remain visible to CI and developers on Windows and Unix.

## Scope and boundaries

- Modify `package.json` only to change the `test` script to `node scripts/run-tests.mjs`.
- Create `scripts/run-tests.mjs` with exported pure argument-classification/command-planning functions and a CLI entry point.
- Add `__tests__/scripts/run-tests.test.mjs` covering no arguments, unit-only, integration-only, mixed paths, shared flags, slash normalization, and first-failure command ordering.
- Do not change application routes, migrations, database schemas, Neon branch state, integration setup, pricing, Stripe, auth providers, or production configuration.
- Do not install or substitute Neon credentials as part of this source fix. The separate `neonctl` environment gate remains required before the release run.
- Do not change the release candidate's existing test assertions merely to make the command green.

## Error handling

- If a runner exits non-zero, stop immediately and return that exit code; do not start the next runner.
- If the Vitest child process cannot be spawned, print the system error through inherited stderr and return a non-zero exit code.
- If a command has no file paths but has flags, run both configured runners with those flags, preserving the full-suite behavior.
- The dispatcher must not print environment variables, database URLs, credentials, request bodies, or test payloads.

## Verification contract

The implementation is complete only when all of the following are true on the same candidate:

1. `npm.cmd test -- __tests__/api/scan.test.ts __tests__/lib/auth.test.ts` exits 0 and runs the unit runner once without a false integration `No test files found` failure.
2. `npm.cmd test -- __tests__/integration/<existing-test-file>` routes only to the integration runner and preserves its global setup.
3. `npm.cmd test -- <one-unit-path> <one-integration-path>` runs unit first and integration second, with each receiving only its matching path.
4. `npm.cmd test` still invokes unit then integration; it remains blocked if `neonctl` is unavailable or unauthenticated, rather than silently skipping integration.
5. The focused release command from the release-gate plan passes all requested unit contracts under the dispatcher.
6. The new routing tests, the existing focused unit contracts, typecheck, lint, and placeholder build pass; no migrations or production resources are touched.

## Alternatives rejected

1. **Change the release plan to call `test:unit` only.** This avoids the false failure but leaves the widely documented `npm test -- <path>` contract broken and makes future focused commands misleading.
2. **Use a shell-specific conditional in `package.json`.** This is shorter but is not reliably portable across PowerShell, cmd.exe, Bash, and CI runners.
3. **Make `test` run only unit tests and add a separate full-suite script.** This would weaken the existing safety contract that `npm test` includes the Neon-backed integration suite.

