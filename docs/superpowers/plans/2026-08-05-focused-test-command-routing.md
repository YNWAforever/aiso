# Focused Test Command Routing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `npm test -- <paths>` route focused paths to the correct Vitest runner without weakening the no-argument unit-plus-Neon-integration test contract.

**Architecture:** A cross-platform `scripts/run-tests.mjs` module will classify npm-forwarded arguments into shared flags, unit paths, and integration paths. It will build an ordered unit/integration command plan and execute child Vitest processes serially, stopping on the first failure. `package.json` will point only the `test` script at this dispatcher; the existing `test:unit` and `test:integration` scripts remain the canonical runner definitions.

**Tech Stack:** Node.js 24 ESM, npm scripts, Vitest 4, Vitest integration config, PowerShell verification, existing Next.js/TypeScript repository.

## Global Constraints

- Preserve the existing full-suite contract: `npm test` with no arguments runs unit then Neon-backed integration.
- Keep `test:unit` and `test:integration` script semantics unchanged.
- Do not change application routes, migrations, database schemas, Neon branch state, integration setup, pricing, Stripe, auth providers, or production configuration.
- Do not install or substitute Neon credentials as part of this source fix; the separate authenticated `neonctl` gate remains required.
- Do not change existing release-gate assertions merely to make a command green.
- Preview-first; do not deploy to production or run production migrations.
- Do not rotate secrets, provision paid/cloud resources, alter unrelated worktree changes, or add sensitive evidence.
- Do not add `.codebase-memory` files to the repository.

---

### Task 1: Build and test the deterministic argument-routing module

**Files:**
- Create: `scripts/run-tests.mjs`
- Create: `__tests__/scripts/run-tests.test.mjs`

**Interfaces:**
- Consumes: `readonly string[]` arguments passed after npm's `--` separator.
- Produces: `classifyTestArgs(args)` and `buildTestRunPlan(args)` exports, plus `runTestPlan(plan, execute)` for serial execution with injectable process execution.

- [ ] **Step 1: Write the failing routing tests**

Create `__tests__/scripts/run-tests.test.mjs` with Vitest tests that import the not-yet-created module and assert these exact plans:

```js
import { describe, expect, it, vi } from 'vitest'

import { buildTestRunPlan, classifyTestArgs, runTestPlan } from '../../scripts/run-tests.mjs'

const unitBase = ['run', '--exclude', '__tests__/integration/**']
const integrationBase = ['run', '--config', 'vitest.integration.config.ts']

describe('classifyTestArgs', () => {
  it('separates unit paths, integration paths, and shared flags', () => {
    expect(classifyTestArgs([
      '--reporter=dot',
      '__tests__/api/scan.test.ts',
      '__tests__\\integration\\brand-creation.test.ts',
    ])).toEqual({
      sharedArgs: ['--reporter=dot'],
      unitPaths: ['__tests__/api/scan.test.ts'],
      integrationPaths: ['__tests__\\integration\\brand-creation.test.ts'],
    })
  })
})

describe('buildTestRunPlan', () => {
  it('runs unit then integration for no arguments', () => {
    expect(buildTestRunPlan([])).toEqual([
      { runner: 'unit', args: unitBase },
      { runner: 'integration', args: integrationBase },
    ])
  })

  it('routes unit-only paths to unit without a false integration run', () => {
    expect(buildTestRunPlan(['__tests__/api/scan.test.ts'])).toEqual([
      { runner: 'unit', args: [...unitBase, '__tests__/api/scan.test.ts'] },
    ])
  })

  it('routes integration-only paths to integration', () => {
    expect(buildTestRunPlan(['__tests__/integration/brand-creation.test.ts'])).toEqual([
      { runner: 'integration', args: [...integrationBase, '__tests__/integration/brand-creation.test.ts'] },
    ])
  })

  it('keeps shared flags and partitions mixed paths in unit-first order', () => {
    expect(buildTestRunPlan([
      '--reporter=dot',
      '__tests__/api/scan.test.ts',
      '__tests__/integration/brand-creation.test.ts',
    ])).toEqual([
      { runner: 'unit', args: [...unitBase, '--reporter=dot', '__tests__/api/scan.test.ts'] },
      { runner: 'integration', args: [...integrationBase, '--reporter=dot', '__tests__/integration/brand-creation.test.ts'] },
    ])
  })
})

describe('runTestPlan', () => {
  it('stops after the first non-zero runner result', async () => {
    const execute = vi.fn()
      .mockResolvedValueOnce(7)
      .mockResolvedValueOnce(0)

    await expect(runTestPlan([
      { runner: 'unit', args: unitBase },
      { runner: 'integration', args: integrationBase },
    ], execute)).resolves.toBe(7)
    expect(execute).toHaveBeenCalledTimes(1)
  })
})
```

- [ ] **Step 2: Run the routing tests to verify the failure**

Run from `C:\Users\laich\Documents\geoscanner\.worktrees\release-stability`:

```powershell
npm.cmd run test:unit -- __tests__/scripts/run-tests.test.mjs
```

Expected: FAIL because `../../scripts/run-tests.mjs` does not exist yet. Do not create the implementation before observing this module-resolution failure.

- [ ] **Step 3: Implement the pure classifier, plan builder, and injectable serial runner**

Create `scripts/run-tests.mjs` with these exact behaviors:

```js
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const UNIT_BASE_ARGS = ['run', '--exclude', '__tests__/integration/**']
const INTEGRATION_BASE_ARGS = ['run', '--config', 'vitest.integration.config.ts']

export function classifyTestArgs(args) {
  const sharedArgs = []
  const unitPaths = []
  const integrationPaths = []

  for (const arg of args) {
    if (arg.startsWith('-')) {
      sharedArgs.push(arg)
      continue
    }

    const normalized = arg.replaceAll('\\', '/')
    if (normalized.includes('__tests__/integration/')) {
      integrationPaths.push(arg)
    } else {
      unitPaths.push(arg)
    }
  }

  return { sharedArgs, unitPaths, integrationPaths }
}

export function buildTestRunPlan(args) {
  const { sharedArgs, unitPaths, integrationPaths } = classifyTestArgs(args)
  const plan = []

  if (unitPaths.length > 0 || integrationPaths.length === 0) {
    plan.push({
      runner: 'unit',
      args: [...UNIT_BASE_ARGS, ...sharedArgs, ...unitPaths],
    })
  }

  if (integrationPaths.length > 0 || unitPaths.length === 0) {
    plan.push({
      runner: 'integration',
      args: [...INTEGRATION_BASE_ARGS, ...sharedArgs, ...integrationPaths],
    })
  }

  return plan
}

export async function runTestPlan(plan, execute) {
  for (const run of plan) {
    const exitCode = await execute(run)
    if (exitCode !== 0) return exitCode
  }
  return 0
}

function executeVitest(run) {
  const executable = process.platform === 'win32' ? 'vitest.cmd' : 'vitest'
  return new Promise((resolve) => {
    const child = spawn(executable, run.args, {
      shell: process.platform === 'win32',
      stdio: 'inherit',
    })
    child.once('error', () => resolve(1))
    child.once('close', (code) => resolve(code ?? 1))
  })
}

export async function main(args = process.argv.slice(2)) {
  return runTestPlan(buildTestRunPlan(args), executeVitest)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main()
}
```

The module must not spawn Vitest when imported by tests. Preserve the exact argument order shown above so unit runs precede integration runs and shared flags reach both selected runners.

- [ ] **Step 4: Run the routing tests and the module typecheck**

Run:

```powershell
npm.cmd run test:unit -- __tests__/scripts/run-tests.test.mjs
npm.cmd exec tsc -- --noEmit
```

Expected: all routing tests pass, and TypeScript exits 0. If the `.mjs` test is not included by Vitest, correct the test file placement or Vitest discovery without changing the test contract.

- [ ] **Step 5: Commit the module and routing tests**

```powershell
git add scripts/run-tests.mjs __tests__/scripts/run-tests.test.mjs
git commit -m "test: add focused runner routing contract"
```

### Task 2: Wire the npm script and verify CLI behavior

**Files:**
- Modify: `package.json:13` (`scripts.test` only)
- Create: `__tests__/scripts/package-test-script.test.mjs`
- Read-only verification: `vitest.integration.config.ts`, `__tests__/integration/brand-creation.test.ts`

**Interfaces:**
- Consumes: `buildTestRunPlan` and `main` from Task 1.
- Produces: `npm test` full-suite behavior plus focused argument routing.

- [ ] **Step 1: Write the package-script contract test**

Add `__tests__/scripts/package-test-script.test.mjs`:

```js
import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

describe('npm test wiring', () => {
  it('uses the cross-platform dispatcher while preserving dedicated runners', async () => {
    const packageJson = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'))
    expect(packageJson.scripts.test).toBe('node scripts/run-tests.mjs')
    expect(packageJson.scripts['test:unit']).toBe("vitest run --exclude '__tests__/integration/**'")
    expect(packageJson.scripts['test:integration']).toBe('vitest run --config vitest.integration.config.ts')
  })
})
```

Run before wiring:

```powershell
npm.cmd run test:unit -- __tests__/scripts/package-test-script.test.mjs
```

Expected: FAIL only on the `scripts.test` assertion because `package.json` still contains the old chained command.

- [ ] **Step 2: Change only the `test` script**

Edit `package.json` so the scripts block contains:

```json
"test": "node scripts/run-tests.mjs",
"test:unit": "vitest run --exclude '__tests__/integration/**'",
"test:integration": "vitest run --config vitest.integration.config.ts"
```

Do not reformat unrelated dependencies or scripts.

- [ ] **Step 3: Run the package contract and exact focused command**

Run:

```powershell
npm.cmd run test:unit -- __tests__/scripts/package-test-script.test.mjs __tests__/scripts/run-tests.test.mjs
npm.cmd test -- __tests__/api/scan.test.ts __tests__/lib/auth.test.ts
```

Expected: both commands exit 0. The focused command runs the unit runner once and does not print the integration runner's `No test files found` error.

- [ ] **Step 4: Verify integration-only and mixed routing without weakening the Neon gate**

Run:

```powershell
npm.cmd test -- __tests__/integration/brand-creation.test.ts
npm.cmd test -- __tests__/api/scan.test.ts __tests__/integration/brand-creation.test.ts
```

Expected: the integration-only command enters `__tests__/integration/setup.ts`; the mixed command runs unit first and then integration. If Neon credentials or `neonctl` are unavailable, the command may fail in integration setup, but it must not fail with the prior argument-routing `No test files found` error.

- [ ] **Step 5: Commit the npm wiring and contract test**

```powershell
git add package.json __tests__/scripts/package-test-script.test.mjs
git commit -m "fix: route focused vitest commands safely"
```

### Task 3: Re-run release evidence and reconcile the Neon blocker

**Files:**
- Verify: all focused release contract paths from `docs/superpowers/plans/2026-08-05-release-gate-hardening.md`
- Write only: `C:\tmp\fimmick-release-evidence\<candidate-sha>.md`
- Read-only: `package.json`, `playwright.config.ts`, `tests/globalSetup.ts`, `tests/globalTeardown.ts`

**Interfaces:**
- Consumes: wired dispatcher and clean candidate from Task 2.
- Produces: redacted deterministic-gate evidence for the new candidate SHA; no production state changes.

- [ ] **Step 1: Run the full focused release contract command**

Run from the release worktree:

```powershell
npm.cmd test -- __tests__/api/dashboard-clients.test.ts __tests__/api/brand-creation-contract.test.ts __tests__/lib/database-error.test.ts __tests__/lib/auth-client.test.ts __tests__/lib/auth.test.ts __tests__/e2e/funnel-verification-contract.test.ts __tests__/api/scan-funnel-contract.test.ts __tests__/api/scan.test.ts __tests__/api/scan-security.test.ts __tests__/api/scan-flow.test.ts __tests__/db/client-report-migration.test.ts __tests__/migrations/neon-role-portability.test.mjs __tests__/migrations/role-guard-analyzer.test.mjs __tests__/api/client-reports.test.ts __tests__/api/public-client-reports.test.ts __tests__/api/report-branding.test.ts __tests__/lib/report-comparison.test.ts __tests__/lib/report-snapshot.test.ts __tests__/lib/report-store.test.ts __tests__/lib/report-share.test.ts __tests__/lib/report-branding.test.ts __tests__/lib/report-client-dto.test.ts __tests__/public-report-page.test.tsx
```

Expected: the requested 23 files pass in the unit runner without a false integration no-test failure. This command does not replace the complete integration gate.

- [ ] **Step 2: Run the complete test preflight exactly**

```powershell
Get-Command neonctl -ErrorAction Stop
neonctl auth status
npm.cmd test
```

If `neonctl` is missing or unauthenticated, record an environment blocker and stop before the full command; do not install the CLI, provision a branch, or substitute production credentials. If authenticated, record aggregate unit/integration counts without copying connection strings or payloads.

- [ ] **Step 3: Run static gates with test-only values**

```powershell
npm.cmd exec tsc -- --noEmit
npm.cmd run lint
$env:NEON_AUTH_BASE_URL='https://example.neonauth.test'
$env:NEON_AUTH_COOKIE_SECRET='0123456789abcdef0123456789abcdef'
$env:DATABASE_URL='postgresql://test:test@localhost:5432/test'
$env:NEXT_PUBLIC_SUPABASE_URL='https://example.supabase.co'
$env:NEXT_PUBLIC_SUPABASE_ANON_KEY='test-anon'
$env:SUPABASE_SERVICE_ROLE_KEY='test-service-role'
$env:REPORT_SHARE_SECRET='0123456789abcdef0123456789abcdef'
$env:NEXT_PUBLIC_APP_URL='https://fimmick-aeo-oitb.vercel.app'
npm.cmd run build
git diff --check
```

Expected: TypeScript/build exit 0, lint has zero errors, and only known baseline warnings are recorded. Never print the placeholder values or any loaded environment file.

- [ ] **Step 4: Write redacted evidence and review the final diff**

Write `C:\tmp\fimmick-release-evidence\<candidate-sha>.md` containing only the SHA, command names, aggregate counts, pass/fail, warning categories, and any Neon environment blocker. Verify:

```powershell
git status --short --branch
git diff --check
git diff --name-only 6867008..HEAD -- supabase/migrations
```

Expected: no migration paths changed, no credentials/payloads/personal data in evidence, and the release worktree is clean. Do not push, deploy, run Preview migration 027, or run production migration from this task.

- [ ] **Step 5: Commit any evidence metadata only if required by repository policy**

Evidence stays outside Git under `C:\tmp`. If no repository metadata is required, make no empty commit; report the candidate SHA and the exact environment blocker instead.
