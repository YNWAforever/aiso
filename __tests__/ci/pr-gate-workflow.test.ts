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

    for (const job of ['static', 'unit-contract', 'integration', 'e2e-accessibility', 'build', 'cloudflare-worker', 'pr-gate']) {
      expect(workflow).toMatch(new RegExp(`^  ${job}:\\s*$`, 'm'))
    }
    expect(workflow).toMatch(/pr-gate:\s*\n\s+if:\s+\$\{\{ always\(\) \}\}\s*\n\s+needs:\s+\[static, unit-contract, integration, e2e-accessibility, build, cloudflare-worker\]/)

    expect(workflow).toMatch(/node-version:\s+24\.x/)
    expect(workflow).toContain('npm ci')
    expect(workflow).toContain('npm run lint')
    expect(workflow).toContain('npm run typecheck')
    expect(workflow).toContain('npm test -- --coverage')
    const e2eCommand = workflow.match(/npm run e2e -- ([^\r\n]+)/)?.[1] ?? ''
    expect(e2eCommand).toContain('--workers=1')
    expect(e2eCommand).toContain('--shard=${{ matrix.shard }}/4')
    expect(workflow).toContain('shard: [1, 2, 3, 4]')
    expect(workflow).toContain('fail-fast: false')
    expect(workflow).toContain('node scripts/ci/merge-e2e-shards.mjs')
    const reporters = e2eCommand.match(/--reporter=([^ ]+)/)?.[1].split(',')
    expect(reporters).toEqual(expect.arrayContaining(['list', 'html', 'json', 'junit']))
    expect(e2eCommand).not.toMatch(/--(?:project|grep|max-failures)\b/)
    expect(e2eCommand).toContain('tee artifacts/e2e-accessibility/playwright.log')
    const e2eJob = workflow.slice(workflow.indexOf('  e2e-accessibility:'), workflow.indexOf('\n  build:'))
    expect(e2eJob).toContain('node scripts/ci/classify-playwright.mjs')
    for (const slice of ['C9C', 'C9C_DRAFT','C9D','C9D_APPROVERS','C9E','C9F']) {
      expect(e2eJob).toContain(`${slice}_HTML_DIR: .next/component-fixtures/${slice}`)
      expect(e2eJob).toContain(`${slice}_CSS_PATH: .next/component-fixtures/build.css`)
    }
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

  it('defines the expected job list and gates every job it does define', async () => {
    // The integration job now exists (item 0.11). This test's remaining job is to keep
    // `pr-gate`'s `needs` list honest — every job other than the aggregator itself must
    // appear there, or that job can fail while the gate still reports success.
    const workflow = await readWorkflow()
    // Search for '\njobs:' without a trailing '\n' — on a Windows checkout with
    // core.autocrlf=true the line is '\njobs:\r\n', so a trailing '\n' would never
    // match, indexOf would return -1, and slice(-1) would silently collapse
    // jobsSection down to the workflow's last character.
    const jobsSection = workflow.slice(workflow.indexOf('\njobs:'))
    // The `$` anchor alone doesn't match a line ending in `\r\n` (e.g. on a Windows
    // checkout with core.autocrlf=true), which would silently parse jobNames as [].
    const jobNames = [...jobsSection.matchAll(/^ {2}([\w-]+):\r?$/gm)].map((match) => match[1])

    expect(jobNames).toEqual(['static', 'unit-contract', 'integration', 'e2e-accessibility', 'build', 'cloudflare-worker', 'pr-gate'])

    // Every job other than the aggregator itself must appear in `needs`, or that
    // job can fail while the gate still reports success.
    const gateJob = jobsSection.slice(jobsSection.indexOf('\n  pr-gate:'))
    const needed = (gateJob.match(/needs:\s+\[([^\]]+)\]/)?.[1] ?? '')
      .split(',')
      .map((name) => name.trim())

    expect(needed).toEqual(jobNames.filter((name) => name !== 'pr-gate'))
  })
})

describe('single-run disposable role authorization', () => {
  it('offers a manual opt-in that defaults off and feeds only the integration role gate', async () => {
    const workflow = await readWorkflow()
    expect(workflow).toMatch(/workflow_dispatch:\s*\n\s+inputs:\s*\n\s+allow_disposable_role_password:/)
    const input = workflow.slice(workflow.indexOf('      allow_disposable_role_password:'), workflow.indexOf('\npermissions:'))
    expect(input).toMatch(/type:\s+boolean/)
    expect(input).toMatch(/default:\s+false/)
    expect(input).not.toMatch(/default:\s+true/)
    const integration = workflow.slice(workflow.indexOf('  integration:'), workflow.indexOf('\n  e2e-accessibility:'))
    expect(integration).toContain('node scripts/ci/resolve-disposable-role-authorization.mjs')
    expect(integration).toContain('AISO_MANUAL_ROLE_APPROVAL: ${{ inputs.allow_disposable_role_password }}')
    expect(integration).toContain('ALLOW_DISPOSABLE_ROLE_PASSWORD: ${{ steps.disposable-role-authorization.outputs.allowed }}')
  })
  it('preserves and uploads the exact-target log outside the report reset directory', async () => {
    const workflow = await readWorkflow()
    const integration = workflow.slice(workflow.indexOf('  integration:'), workflow.indexOf('\n  e2e-accessibility:'))
    const wrapper = await readFile(resolve(process.cwd(), 'scripts/ci/run-exact-target-suites.mjs'), 'utf8')
    expect(wrapper).toContain("const REPORT_DIR = join('artifacts', 'exact-target')")
    expect(wrapper).toContain('rmSync(REPORT_DIR, { recursive: true, force: true })')
    const teePath = integration.match(/node scripts\/ci\/run-exact-target-suites\.mjs[^\r\n]*?tee ([^\s]+)/)?.[1]
    expect(teePath).toBe('artifacts/integration/exact-target-wrapper.log')
    expect(integration).toContain('--artifact integration/exact-target-wrapper.log')
    expect(integration).toMatch(/Upload integration diagnostics[\s\S]*path:[\s\S]*artifacts\/integration\//)
  })

})


it('records checkout-bound branch receipts outside buffered stdout', async () => {
 const workflow = await readWorkflow()
 const integration = workflow.slice(workflow.indexOf('  integration:'),workflow.indexOf('  e2e-accessibility:'))
 expect(integration).toContain("AISO_RECORD_BRANCH_PROVENANCE: '1'")
 expect(integration).toContain('export AISO_TEST_CHECKOUT_SHA="$(git rev-parse HEAD)"')
 expect(integration.indexOf('export AISO_TEST_CHECKOUT_SHA')).toBeLessThan(integration.indexOf('npx vitest run'))
 expect(integration).toMatch(/Upload integration diagnostics[\s\S]*if: always\(\)/)
 expect(integration).toMatch(/path:[\s\S]*artifacts\/integration\//)
})
