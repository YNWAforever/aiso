import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflowPath = resolve(process.cwd(), '.github/workflows/pr-gate.yml')

async function readWorkflow() {
  return readFile(workflowPath, 'utf8')
}

describe('PR gate workflow contract', () => {
  it('defines the fail-closed pull request gate and fixture-only diagnostics', async () => {
    const workflow = await readWorkflow()

    expect(workflow).toMatch(/^name: PR gate$/m)
    expect(workflow).toMatch(/^\s*pull_request:\s*$/m)
    expect(workflow).toMatch(/types:\s*\[opened, synchronize, reopened\]/)
    expect(workflow).toMatch(/^\s*workflow_dispatch:\s*$/m)
    expect(workflow).not.toContain('pull_request_target')
    expect(workflow).toMatch(/permissions:\s*\n\s+contents:\s+read/)
    expect(workflow).toMatch(/group:\s+pr-gate-\$\{\{ github\.event\.pull_request\.number \|\| github\.ref \}\}/)
    expect(workflow).toMatch(/cancel-in-progress:\s+true/)

    for (const job of ['static', 'unit-contract', 'e2e-accessibility', 'build', 'pr-gate']) {
      expect(workflow).toMatch(new RegExp(`^  ${job}:\\s*$`, 'm'))
    }
    expect(workflow).toMatch(/pr-gate:\s*\n\s+if:\s+\$\{\{ always\(\) \}\}\s*\n\s+needs:\s+\[static, unit-contract, e2e-accessibility, build\]/)

    expect(workflow).toMatch(/node-version:\s+24\.x/)
    expect(workflow).toContain('npm ci')
    expect(workflow).toContain('npm run lint')
    expect(workflow).toContain('npm run typecheck')
    expect(workflow).toContain('npm test -- --coverage')
    expect(workflow).toContain('npm run e2e -- --reporter=html,json,junit')
    const e2eJob = workflow.slice(workflow.indexOf('  e2e-accessibility:'), workflow.indexOf('\n  build:'))
    expect(e2eJob).toContain('node scripts/ci/classify-playwright.mjs')
    expect(e2eJob).not.toContain('--skipped 0')
    expect(workflow).toContain('npm run build')
    expect(workflow).toContain('E2E_FIXTURE_MODE: 1')
    expect(workflow).toContain('BASE_URL: http://127.0.0.1:3000')
    expect(workflow).toContain('DATABASE_URL: postgresql://fixture:fixture@127.0.0.1:5432/fixture')
    expect(workflow).toContain('NEXT_PUBLIC_SUPABASE_URL: https://fixture.invalid')
    expect(workflow).toContain('REPORT_SHARE_SECRET: fixture-report-share-secret-for-ci-only-00000001')
    expect(workflow).toContain('NEON_AUTH_COOKIE_SECRET: fixture-neon-auth-cookie-secret-for-ci-only-00000001')

    expect(workflow).toContain('actions/checkout@v4')
    expect(workflow).toContain('actions/setup-node@v4')
    expect(workflow).toContain('actions/upload-artifact@v4')
    expect(workflow).toContain('actions/download-artifact@v4')
    expect(workflow).toContain('node scripts/ci/aggregate-gate.mjs')
    expect(workflow).toMatch(/name:\s+Upload [^\n]+\n\s+if:\s+always\(\)/g)
  })

  it('fetches full history for the migration baseline guard', async () => {
    const workflow = await readWorkflow()
    const unitJob = workflow.slice(workflow.indexOf('  unit-contract:'), workflow.indexOf('\n  e2e-accessibility:'))

    expect(unitJob).toMatch(/uses: actions\/checkout@v4\s*\n\s+with:\s*\n\s+fetch-depth:\s+0/)
  })

  it('omits the integration project on purpose, and gates every job it does define', async () => {
    // The integration project provisions a real Neon branch, which requires a
    // NEON_API_KEY repository secret. The repository has none — `gh api
    // repos/YNWAforever/fimmick-aeo/actions/secrets` reports total_count 0 — so an
    // integration job would fail on every PR and leave the merge gate permanently
    // red. It is therefore left out deliberately.
    //
    // Write the cost down rather than forget it: this omission is the structural
    // reason the `031` ON CONFLICT gap survived to production. The only suite that
    // runs real SQL against a real Postgres has never run on any pull request, so
    // nothing in CI could have caught it.
    //
    // Two controls compensate, and this assertion is what keeps them load-bearing:
    //   - __tests__/lib/pulse-conflict-arbiter.test.ts — a static guard for the
    //     ON CONFLICT-without-a-matching-unique-index class. It needs no database,
    //     so unlike the integration project it does run on every PR.
    //   - docs/runbooks/verify-pulse-rollup.md — the manual procedure for running
    //     the integration suite against a throwaway Neon branch.
    //
    // Adding an integration job fails this test on purpose. That failure is the
    // prompt to confirm NEON_API_KEY actually exists before relying on the job,
    // and to add it to the pr-gate `needs` list so the gate can see it fail.
    const workflow = await readWorkflow()
    const jobsSection = workflow.slice(workflow.indexOf('\njobs:\n'))
    const jobNames = [...jobsSection.matchAll(/^ {2}([\w-]+):$/gm)].map((match) => match[1])

    expect(jobNames.filter((name) => /integration/i.test(name))).toEqual([])
    expect(jobNames).toEqual(['static', 'unit-contract', 'e2e-accessibility', 'build', 'pr-gate'])

    // Every job other than the aggregator itself must appear in `needs`, or that
    // job can fail while the gate still reports success.
    const gateJob = jobsSection.slice(jobsSection.indexOf('\n  pr-gate:'))
    const needed = (gateJob.match(/needs:\s+\[([^\]]+)\]/)?.[1] ?? '')
      .split(',')
      .map((name) => name.trim())

    expect(needed).toEqual(jobNames.filter((name) => name !== 'pr-gate'))
  })
})
