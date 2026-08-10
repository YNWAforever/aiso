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

    expect(workflow).toContain('actions/checkout@v4')
    expect(workflow).toContain('actions/setup-node@v4')
    expect(workflow).toContain('actions/upload-artifact@v4')
    expect(workflow).toContain('actions/download-artifact@v4')
    expect(workflow).toContain('node scripts/ci/aggregate-gate.mjs')
    expect(workflow).toMatch(/name:\s+Upload [^\n]+\n\s+if:\s+always\(\)/g)
  })
})
