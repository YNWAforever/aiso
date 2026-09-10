import { expect } from 'vitest'

/**
 * A skip nobody sees is indistinguishable from a pass.
 *
 * `scripts/run-tests.mjs` is emphatic about this and enforces it for the
 * integration project: an explicitly named integration path is never skipped,
 * because the caller asked for exactly that run, and doing nothing instead would
 * be the silent pass the rule exists to prevent.
 *
 * The five exact-target suites sat outside that protection. Each is excluded from
 * `vitest.integration.config.ts` and reachable only through its own config, which
 * no npm script and no CI job invokes. Run without its `C9*` variables, each
 * reported `1 skipped` and exited 0 — together 109 tests reading as success while
 * asserting nothing at all.
 *
 * Invoking one of those configs IS the explicit request, so an unconfigured run
 * has to fail rather than skip. The suite body stays behind `describe.skipIf`,
 * because the point is one loud, legible failure rather than a cascade of
 * connection errors.
 */
export function assertApprovedTarget(configured: unknown, variables: string): void {
  expect(
    Boolean(configured),
    'This config only runs against a separately provisioned disposable Neon branch, and none is configured.\n'
    + `Set ${variables} (plus TEST_DATABASE_URL where the suite reads it), or run "npm test" for the suites that provision their own branch.\n`
    + 'Skipping here would report success for tests that never ran.',
  ).toBe(true)
}
