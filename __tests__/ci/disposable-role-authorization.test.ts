import { spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmdirSync, unlinkSync, existsSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveDisposableRoleAuthorization } from '../../scripts/ci/resolve-disposable-role-authorization.mjs'

const directories: string[] = []
afterEach(() => {
  for (const directory of directories.splice(0)) {
    const output = join(directory, 'output')
    if (existsSync(output)) unlinkSync(output)
    rmdirSync(directory)
  }
})
function runStep(eventName: string, manualApproval: string, withOutput = true) {
  const directory = mkdtempSync(join(tmpdir(), 'aiso-role-authorization-'))
  directories.push(directory)
  const output = join(directory, 'output')
  const result = spawnSync(process.execPath, ['scripts/ci/resolve-disposable-role-authorization.mjs'], {
    cwd: resolve(process.cwd()), encoding: 'utf8',
    env: { ...process.env, GITHUB_EVENT_NAME: eventName, AISO_MANUAL_ROLE_APPROVAL: manualApproval,
      AISO_REPOSITORY_ROLE_APPROVAL: '', GITHUB_OUTPUT: withOutput ? output : '' },
  })
  return { result, output }
}

describe('disposable role approval belongs to the authorized invocation', () => {
  it.each([
    ['pull_request', 'true'], ['push', 'true'], ['schedule', 'true'],
    ['workflow_dispatch', 'false'], ['workflow_dispatch', ''],
    ['workflow_dispatch', '1'], ['workflow_dispatch', 'yes'],
    ['workflow_dispatch', 'TRUE'], ['workflow_dispatch', undefined],
  ])('keeps %s / %s unapproved', (eventName, manualApproval) => {
    expect(resolveDisposableRoleAuthorization({ eventName, manualApproval }))
      .toEqual({ allowed: '0', source: 'unapproved' })
  })
  it('allows an explicit true for this manual invocation', () => {
    expect(resolveDisposableRoleAuthorization({ eventName: 'workflow_dispatch', manualApproval: 'true' }))
      .toEqual({ allowed: '1', source: 'manual-run' })
  })
  it('preserves an existing explicit repository delegation without creating one', () => {
    expect(resolveDisposableRoleAuthorization({ eventName: 'pull_request', manualApproval: 'false', repositoryApproval: '1' }))
      .toEqual({ allowed: '1', source: 'repository' })
  })
  it.each(['', 'true', 'false', undefined])('rejects non-opt-in repository values: %s', repositoryApproval => {
    expect(resolveDisposableRoleAuthorization({ eventName: 'pull_request', repositoryApproval }))
      .toEqual({ allowed: '0', source: 'unapproved' })
  })
  it('writes the approved result to the actual GitHub output file', () => {
    const { result, output } = runStep('workflow_dispatch', 'true')
    expect(result.status).toBe(0)
    expect(readFileSync(output, 'utf8')).toBe('allowed=1\nsource=manual-run\n')
  })
  it('a forged manual input on a PR still writes a denial', () => {
    const { result, output } = runStep('pull_request', 'true')
    expect(result.status).toBe(0)
    expect(readFileSync(output, 'utf8')).toBe('allowed=0\nsource=unapproved\n')
  })
  it('fails the step if its output cannot reach the following integration step', () => {
    const { result } = runStep('workflow_dispatch', 'true', false)
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('GITHUB_OUTPUT is required')
  })
  it('importing the policy does not run a step or write output', () => {
    const result = spawnSync(process.execPath, ['--input-type=module', '-e', "await import('./scripts/ci/resolve-disposable-role-authorization.mjs')"], {
      cwd: process.cwd(), encoding: 'utf8', env: { ...process.env, GITHUB_OUTPUT: '' },
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toBe('')
    expect(result.stderr).toBe('')
  })
})
