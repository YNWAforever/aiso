# PR Merge Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (- [ ]) syntax for tracking.

**Goal:** Add a deterministic, evidence-producing GitHub Actions pull-request gate for the repository's revenue, security, entitlement, alert-evaluation, migration, citation, E2E, accessibility, and build paths.

**Architecture:** Keep the application runtime unchanged for normal environments. Add repository-owned CI scripts and a fixture-only E2E mode behind E2E_FIXTURE_MODE=1; run static analysis, the complete Vitest suite, critical Playwright journeys, and the production build in parallel; expose one fail-closed pr-gate aggregate check for branch protection.

**Tech Stack:** Next.js 16.2.4, React 19, TypeScript 5.9, Vitest 4 with V8 coverage, Playwright, axe-core Playwright integration, npm lockfile installs, GitHub Actions.

## Global Constraints

- Treat the current checkout as the behavior baseline. Use the research report as a requirements and risk source, not as proof that a capability exists.
- Do not load .env.local, production credentials, customer data, live Neon/Supabase databases, AI providers, email services, Slack, Stripe, or paid services in PR jobs.
- Unit tests must reject outbound network access unless an individual test explicitly replaces fetch with a deterministic stub.
- PR E2E runs use only loopback services and the checked-in fixture; they use zero retries and fail when a required setup condition is missing.
- A P0, security, tenant, entitlement, alert-integrity, migration, static, E2E, accessibility-blocking, or build failure blocks pr-gate. P1/P2 test failures are recorded in artifacts without changing the initial blocking policy.
- Use pull_request, never pull_request_target, and grant workflow jobs read-only repository permissions.
- Preserve the untracked .codebase-memory/ directory and all unrelated work.
- Do not configure a numeric coverage threshold until the first baseline is measured and reviewed.
- Do not automate branch-protection mutation in this implementation. The final handoff documents the manual requirement for the pr-gate check.

## Current Repository Map

| Area | Current evidence | Planned change |
|---|---|---|
| Commands | package.json has lint, test, e2e, and build, but no typecheck | Add npm run typecheck and CI reporters |
| Unit tests | __tests__/** already covers tiers, auth, API contracts, alerts, citations, and migrations | Add deterministic setup, manifest traceability, and missing contract cases |
| Alert evaluation | __tests__/lib/alerts/evaluate.test.ts and __tests__/api/cron/evaluate-alerts.test.ts use in-memory adapters | Keep these as the P0 alert layer and map them in the manifest |
| Citation analysis | __tests__/checks/citationDensity.test.ts and __tests__/api/pulse-flow.test.ts exercise citation behavior | Map them as deterministic citation coverage |
| Migrations | supabase/migrations/023_alert_evaluation_hardening.sql and 024_alert_evaluation_snapshot_refinement.sql have focused SQL tests | Add ordering, grant, and transaction-safety contracts |
| E2E bootstrap | tests/globalSetup.ts and tests/globalTeardown.ts call Supabase and silently permit missing credentials | Replace with a local fixture assertion and no network calls |
| Public result page | app/[lang]/result/[id]/page.tsx reads Neon through lib/db.ts | Add a server-only fixture branch gated by E2E_FIXTURE_MODE=1 |
| Playwright config | playwright.config.ts loads .env.local, permits BASE_URL, and retries twice in CI | Fence CI to loopback, disable retries, and upload deterministic reports |
| CI | No .github/workflows directory exists | Add .github/workflows/pr-gate.yml with four parallel jobs and one aggregate |

---

## Task 1: Add the command, test-isolation, and evidence contracts

**Files:**

- Create: __tests__/setup/ci-network.ts
- Create: __tests__/ci/gate-scripts.test.ts
- Create: scripts/ci/classify-vitest.mjs
- Create: scripts/ci/write-job-summary.mjs
- Create: scripts/ci/aggregate-gate.mjs
- Modify: package.json
- Modify: vitest.config.ts

**Interfaces:**

- GateJobSummary JSON shape:

    {
      "schemaVersion": 1,
      "job": "unit-contract",
      "commitSha": "value supplied by GITHUB_SHA",
      "status": "success",
      "executed": 1,
      "skipped": 0,
      "failurePriorities": [],
      "artifacts": ["unit-contract/vitest.json", "unit-contract/vitest.junit.xml"]
    }

- classify-vitest.mjs consumes a Vitest JSON report, the original Vitest exit code, and ci/pr-gate-manifest.json. It writes a sanitized artifacts/unit-contract-summary.json and exits nonzero when the report is missing, a required test is skipped, an unmatched failure is found, or a P0 failure is present. A P1/P2-only failure is recorded and returns zero.
- write-job-summary.mjs consumes --job, --status, --executed, --skipped, --priority, and --artifact arguments and writes one summary without copying environment values or report payloads.
- aggregate-gate.mjs consumes STATIC_RESULT, UNIT_CONTRACT_RESULT, E2E_ACCESSIBILITY_RESULT, and BUILD_RESULT, downloads the four summaries, writes artifacts/gate-summary.json, and exits nonzero unless every required job succeeded and no summary reports a required skip or P0 failure.

**Steps:**

- [ ] Write __tests__/ci/gate-scripts.test.ts first. Cover: a successful summary preserves the schema and fixture-only artifact paths; a P1 failure returns an advisory result; a P0 failure returns a blocking result; a missing report fails closed; an aggregate with one failed dependency exits nonzero; and an aggregate containing a skipped required test exits nonzero.

    it('blocks an aggregate when a required job is not successful', async () => {
      const result = await runAggregate({
        STATIC_RESULT: 'success',
        UNIT_CONTRACT_RESULT: 'failure',
        E2E_ACCESSIBILITY_RESULT: 'success',
        BUILD_RESULT: 'success',
      })

      expect(result.exitCode).toBe(1)
      expect(result.summary.failurePriorities).toContain('P0')
    })

- [ ] Implement the pure parsing and classification functions in the three scripts/ci/*.mjs files. Parse only test counts, statuses, priorities, commit SHA, and artifact paths; never serialize raw test output, URLs, tokens, email addresses, or provider payloads.
- [ ] Add the CI network guard in __tests__/setup/ci-network.ts. When CI is set, install a fetch stub that throws Network access is disabled in CI unit tests; tests that need HTTP-shaped behavior must replace that stub locally with vi.stubGlobal('fetch', ...).
- [ ] Add "typecheck": "tsc --noEmit" to package.json.
- [ ] Update vitest.config.ts with setupFiles: ['./__tests__/setup/ci-network.ts'], V8 coverage reporters text, json-summary, and html, and CI-only default, json, and junit reporters writing under artifacts/. Keep the existing Node environment, aliases, exclusions, and Neon auth inline dependency.
- [ ] Set unstubGlobals: true so an individual test's HTTP stub cannot leak into another test file.
- [ ] Run the focused red/green loop:

    npm.cmd test -- __tests__/ci/gate-scripts.test.ts
    npm.cmd run typecheck
    npm.cmd test -- __tests__/ci/gate-scripts.test.ts --run

  Expected result: the focused contract tests pass, and the typecheck command exists and exits successfully.
- [ ] Commit this task as test: add merge gate evidence contract.

## Task 2: Replace live E2E setup with a deterministic Neon-free fixture

**Files:**

- Create: lib/e2e-fixtures.ts
- Create: __tests__/ci/e2e-fixtures.test.ts
- Modify: app/[lang]/result/[id]/page.tsx
- Modify: app/api/scan/lead/route.ts
- Modify: tests/constants.ts
- Modify: tests/globalSetup.ts
- Modify: tests/globalTeardown.ts
- Modify: playwright.config.ts
- Modify: tests/e2e/scan-flow.spec.ts
- Modify: tests/e2e/email-gate.spec.ts
- Modify: tests/e2e/auth.spec.ts

**Interfaces:**

- lib/e2e-fixtures.ts exports E2E_FIXTURE_SCAN_ID, E2E_FIXTURE_SCAN, and getE2EScanFixture(id: string): Scan | null. The getter returns a cloned fixture only when E2E_FIXTURE_MODE === '1' and the ID equals the stable fixture ID; all other inputs return null.

    export const E2E_FIXTURE_SCAN_ID = 'e2e00000-0000-4000-a000-000000000001'

    export function getE2EScanFixture(id: string): Scan | null {
      if (process.env.E2E_FIXTURE_MODE !== '1' || id !== E2E_FIXTURE_SCAN_ID) return null
      return structuredClone(E2E_FIXTURE_SCAN)
    }

- tests/globalSetup.ts validates fixture mode and logs the fixture ID. It performs no HTTP request and throws in CI when fixture mode is absent.
- tests/globalTeardown.ts performs no HTTP request and logs that the in-memory fixture has no cleanup side effect.

**Steps:**

- [ ] Write __tests__/ci/e2e-fixtures.test.ts first. Assert that fixture mode returns a stable scan with core, extended, and GEO results; fixture mode is disabled by default; and an unrecognized scan ID returns null.
- [ ] Add the fixture record in lib/e2e-fixtures.ts with the existing deterministic scan data from tests/globalSetup.ts. Keep all values synthetic, including e2e-test.example.com, and preserve the existing TEST_SCAN_ID through a re-export in tests/constants.ts.
- [ ] In app/[lang]/result/[id]/page.tsx, call getE2EScanFixture(id) before db(). Return the fixture when present and retain the existing Neon query and error handling for normal environments.
- [ ] In app/api/scan/lead/route.ts, after input validation, return { ok: true } for the known fixture ID when fixture mode is enabled. Continue using Neon for all normal requests and reject no new production IDs.
- [ ] Rewrite tests/globalSetup.ts and tests/globalTeardown.ts to remove fs, path, Supabase credentials, REST writes, REST deletes, and warning-based skips.
- [ ] Update playwright.config.ts so CI does not read .env.local, forces baseURL to http://127.0.0.1:3000, uses retries: 0, uses trace: 'retain-on-failure', and sets reuseExistingServer: false. Keep local BASE_URL support only outside CI.
- [ ] Remove Supabase REST preflight calls and test.skip branches from tests/e2e/email-gate.spec.ts and tests/e2e/scan-flow.spec.ts; assert the known fixture result directly. Keep the unrecognized-ID 404 assertion.
- [ ] Update the valid-email test in tests/e2e/auth.spec.ts to stub the repository's Neon Auth route /api/auth/** instead of the obsolete Supabase OTP path. Assert the sent-state UI without contacting an external provider.
- [ ] Run the fixture layer before the full browser suite:

    $env:E2E_FIXTURE_MODE = '1'
    npm.cmd test -- __tests__/ci/e2e-fixtures.test.ts --run
    rg -n 'test\\.skip|\\.skip\\(' tests/e2e

  Expected result: fixture tests pass and the E2E source search returns no skip-based setup path.
- [ ] Commit this task as test: isolate e2e flows from live providers.

## Task 3: Add focused accessibility checks and semantic fixes

**Files:**

- Create: tests/e2e/accessibility.spec.ts
- Modify: package.json
- Modify: package-lock.json
- Modify: components/auth/LoginForm.tsx
- Modify: components/result/EmailCaptureGate.tsx
- Modify: app/[lang]/page.tsx

**Interfaces:**

- Add the current compatible @axe-core/playwright package with npm install --save-dev @axe-core/playwright; commit the resulting lockfile changes.
- The accessibility helper blocks only critical and serious axe violations in the PR gate. It records the full sanitized axe result through Playwright's report rather than printing page content.

    async function expectNoBlockingA11y(page: Page) {
      const results = await new AxeBuilder({ page }).analyze()
      const blocking = results.violations.filter(
        violation => violation.impact === 'critical' || violation.impact === 'serious',
      )
      expect(blocking, JSON.stringify(blocking.map(({ id, impact, nodes }) => ({
        id,
        impact,
        nodeCount: nodes.length,
      })))).toEqual([])
    }

**Steps:**

- [ ] Add @axe-core/playwright, then write tests/e2e/accessibility.spec.ts with three deterministic checks: the English home page, the English login page, and the fixture result page before and after email unlock. Stub /api/scan/lead in the unlock case.
- [ ] Add a keyboard smoke assertion to the same suite: tab from the page start to the scan input, submit control, and primary login controls; assert that each target is reachable and has an accessible name.
- [ ] Add explicit labels and stable IDs to the login email input, both home scan inputs, home industry/region selects, and the result email input. Use visually-hidden labels where the existing visual layout has no label.
- [ ] Give login and result errors role="alert" with aria-live="polite"; associate each input with its error using aria-describedby only while that error is rendered.
- [ ] Preserve existing translations and visible copy. Do not suppress axe rules or weaken the assertion to make an existing violation green.
- [ ] Run:

    npm.cmd test -- __tests__/ci/e2e-fixtures.test.ts --run
    npm.cmd run typecheck

  Expected result: fixture tests and TypeScript validation pass; browser accessibility execution is covered by the later CI workflow run.
- [ ] Commit this task as test: add critical accessibility coverage.

## Task 4: Add priority traceability and migration contracts

**Files:**

- Create: ci/pr-gate-manifest.json
- Create: scripts/ci/validate-test-manifest.mjs
- Create: __tests__/ci/test-manifest.test.ts
- Create: __tests__/supabase/migration-contract.test.ts
- Create: docs/ci/pr-merge-gate-reconciliation.md
- Modify: __tests__/lib/tier.test.ts
- Modify: __tests__/lib/tier-phase3b.test.ts
- Modify: __tests__/lib/alerts/evaluate.test.ts
- Modify: __tests__/api/cron/evaluate-alerts.test.ts
- Modify: __tests__/checks/citationDensity.test.ts
- Modify: __tests__/api/pulse-flow.test.ts

**Interfaces:**

- ci/pr-gate-manifest.json uses this shape:

    {
      "schemaVersion": 1,
      "requiredLayers": ["static", "unit-contract", "e2e-accessibility", "build"],
      "entries": [
        {
          "id": "ENTITLEMENT-P0",
          "priority": "P0",
          "fixture": "tier-boundaries-basic-pro-enterprise",
          "roles": ["authenticated"],
          "files": ["__tests__/lib/tier.test.ts", "__tests__/lib/tier-phase3b.test.ts"]
        }
      ]
    }

- Include entries for ENTITLEMENT-P0, AUTH-TENANT-P0, ALERT-INTEGRITY-P0, MIGRATION-P0, CITATION-P1, and ACCESSIBILITY-P0. Use only roles evidenced in this checkout: anonymous, authenticated, and admin. Record report-only roles that are not evidenced in the reconciliation document rather than inventing behavior.
- validate-test-manifest.mjs verifies unique IDs, valid priorities, nonempty fixtures and roles, existing test files, and presence of all required layers. A missing file or empty layer exits nonzero.

**Steps:**

- [ ] Write __tests__/ci/test-manifest.test.ts first. Assert all required layers are present, every entry has a unique ID and valid priority, every referenced file exists, and at least one P0 entry exists for entitlement, auth/tenant boundaries, alert integrity, and migrations.
- [ ] Add the manifest entries for the existing tier, auth/API, alert, migration, citation, and accessibility suites. Include the fixture name, role set, and test file paths so a report can trace a failure without exposing test data.
- [ ] Implement scripts/ci/validate-test-manifest.mjs and make classify-vitest.mjs fail closed when a failed test path is not represented by a manifest entry.
- [ ] Write __tests__/supabase/migration-contract.test.ts with these exact contracts: numeric migration prefixes are unique and sorted; 023 and 024 both define the alert snapshot RPC; alert RPC execution is granted only to service_role; no alert RPC grant is present for anon or authenticated; and migration SQL contains no transaction-control statements that would break the migration runner.
- [ ] Extend the selected domain tests with explicit boundary assertions: basic/pro/enterprise positive and negative feature access; limit-minus-one, limit, and limit-plus-one quota cases; alert threshold, week-over-week, recovery, deduplication key, delivery failure, and snapshot failure cases; and citation URL normalization, duplicate canonical URL handling, authority tier aggregation, and malformed provider output handling. Reuse the existing in-memory adapters and fixed fixture dates.
- [ ] Create docs/ci/pr-merge-gate-reconciliation.md with this table:

  | Report area | Checkout evidence | Gate treatment |
  |---|---|---|
  | Tiers | lib/tier.ts exposes basic, pro, and enterprise | Test implemented mappings only |
  | Roles | lib/auth.ts exposes authenticated/admin behavior; separate analyst/viewer semantics are not evidenced | Keep those report roles as a follow-up gap |
  | Database | Runtime reads use Neon through lib/db.ts; migration history is under supabase/migrations | Run SQL contracts without a live database |
  | Scripts | No prior typecheck or CI workflow exists | Add typecheck and pr-gate.yml |
  | Operations | Weekly monitoring, staging WCAG, and live-provider canaries are outside this slice | Keep them as follow-up operational gates |

- [ ] Run:

    npm.cmd test -- __tests__/ci/test-manifest.test.ts __tests__/supabase/migration-contract.test.ts --run
    node scripts/ci/validate-test-manifest.mjs

  Expected result: manifest and migration contracts pass, and every referenced test path resolves.
- [ ] Commit this task as test: add gate traceability contracts.

## Task 5: Add the four-job GitHub Actions workflow and aggregate check

**Files:**

- Create: .github/workflows/pr-gate.yml
- Create: __tests__/ci/pr-gate-workflow.test.ts
- Modify: scripts/ci/aggregate-gate.mjs if the workflow contract exposes a missing status case

**Workflow contract:**

    name: PR gate

    on:
      pull_request:
        types: [opened, synchronize, reopened]
      workflow_dispatch:

    permissions:
      contents: read

    concurrency:
      group: pr-gate-\${{ github.event.pull_request.number || github.ref }}
      cancel-in-progress: true

    jobs:
      static:
      unit-contract:
      e2e-accessibility:
      build:
      pr-gate:
        if: \${{ always() }}
        needs: [static, unit-contract, e2e-accessibility, build]

**Steps:**

- [ ] Write __tests__/ci/pr-gate-workflow.test.ts first. Read the workflow as text and assert: pull_request exists; pull_request_target does not; read-only contents permission exists; the four required jobs and pr-gate exist; pr-gate depends on all four jobs; CI uses Node 24; npm ci is present; npm run typecheck, npm test -- --coverage, npm run e2e, and npm run build are present; E2E sets E2E_FIXTURE_MODE=1; and artifact uploads use if: always().
- [ ] Create .github/workflows/pr-gate.yml with actions/checkout@v4, actions/setup-node@v4, actions/upload-artifact@v4, and actions/download-artifact@v4. Each job uses node-version: 24.x, npm ci, the committed package-lock.json, and a bounded timeout.
- [ ] Implement static as two checks: npm run lint and npm run typecheck. Capture logs under artifacts/static/ and write a summary even when either command fails.
- [ ] Implement unit-contract as the full npm test -- --coverage command with CI JSON/JUnit reporters. Capture Vitest's exit code, pass the report through classify-vitest.mjs, and upload artifacts/unit-contract/ including the sanitized summary, JSON/JUnit report, and coverage files. The classifier decides whether P1/P2 failures are advisory; it never hides missing reports, skips, unmatched failures, or P0 failures.
- [ ] Implement e2e-accessibility with E2E_FIXTURE_MODE=1, START_DEV_SERVER=1, BASE_URL=http://127.0.0.1:3000, synthetic DATABASE_URL, synthetic Neon Auth values, and synthetic Supabase values required by browser-only components. Install Chromium with npx playwright install --with-deps chromium, run npm run e2e, and upload the Playwright HTML, JSON/JUnit, screenshots, videos, traces, and summary.
- [ ] Implement build with sanitized values such as DATABASE_URL=postgresql://fixture:fixture@127.0.0.1:5432/fixture, NEXT_PUBLIC_SUPABASE_URL=https://fixture.invalid, NEXT_PUBLIC_SUPABASE_ANON_KEY=fixture-anon-key, SUPABASE_SERVICE_ROLE_KEY=fixture-service-key, NEON_AUTH_BASE_URL=https://fixture.invalid, NEON_AUTH_COOKIE_SECRET=fixture-cookie-secret, and NEXT_PUBLIC_APP_URL=http://127.0.0.1:3000; run npm run build and upload the build log.
- [ ] Make every diagnostic upload use if: always(). Keep job failure status intact; only pr-gate evaluates the dependency results and downloaded summaries.
- [ ] Configure pr-gate with if: always() and the four needs dependencies. Run node scripts/ci/aggregate-gate.mjs with the dependency results in environment variables, upload artifacts/gate-summary.json, and exit nonzero for any failed/cancelled/skipped dependency or required summary failure.
- [ ] Run the workflow contract test locally:

    npm.cmd test -- __tests__/ci/pr-gate-workflow.test.ts --run
    git diff --check

  Expected result: the workflow contains the complete pull-request trigger, all required jobs, sanitized fixture environment, artifact paths, and fail-closed aggregate.
- [ ] Commit this task as ci: add pull request merge gate.

## Task 6: Full verification and branch-protection handoff

**Files:**

- Verify: .github/workflows/pr-gate.yml
- Verify: docs/ci/pr-merge-gate-reconciliation.md
- Verify: package.json, package-lock.json, vitest.config.ts, playwright.config.ts

**Steps:**

- [ ] Restore the pinned dependency tree with npm.cmd ci.
- [ ] Run the repository-owned static and unit commands:

    npm.cmd run lint
    npm.cmd run typecheck
    npm.cmd test -- --coverage

  Expected result: lint, TypeScript validation, and the complete deterministic Vitest suite pass; coverage is produced without a threshold failure.
- [ ] Run the fixture-backed browser suite:

    $env:CI = 'true'
    $env:E2E_FIXTURE_MODE = '1'
    $env:START_DEV_SERVER = '1'
    npm.cmd run e2e

  Expected result: no live provider credentials are read, no E2E test is skipped, and Playwright writes HTML/JSON/JUnit diagnostics.
- [ ] Run npm.cmd run build with the sanitized build environment from the workflow. Expected result: production build succeeds without a live database or provider.
- [ ] Run git diff --check, node scripts/ci/validate-test-manifest.mjs, and the workflow contract tests. Expected result: no whitespace errors, no missing manifest paths, and no workflow contract failures.
- [ ] Inspect git status --short and confirm that only intended gate, fixture, accessibility, manifest, migration-contract, and documentation files changed; leave .codebase-memory/ untouched.
- [ ] In GitHub repository settings, require the check named pr-gate for the protected branch after the workflow has completed once. Do not require individual matrix internals as the public merge contract.
- [ ] Confirm the first pull request run exposes static logs, unit JUnit/coverage, Playwright diagnostics, build logs, and gate-summary.json without secrets or PII.
- [ ] Keep staging manual WCAG review, live database/provider acceptance, weekly brand monitoring, canaries, and production deployment outside this implementation.

---

## Commit Checkpoints

1. test: add merge gate evidence contract
2. test: isolate e2e flows from live providers
3. test: add critical accessibility coverage
4. test: add gate traceability contracts
5. ci: add pull request merge gate

Each checkpoint must pass the focused verification listed in its task before moving to the next task.
