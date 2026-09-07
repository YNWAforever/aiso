import { describe, expect, it } from 'vitest'

import { buildConfigurationReport } from '@/lib/readiness/report'
import { hashPolicy, type RuntimePolicy } from '@/lib/readiness/runtime-contract'
import { buildRuntimeReport, renderRuntimeReport, type RuntimeEvidence } from '@/lib/readiness/runtime-report'

const validPolicy: RuntimePolicy = {
  version: 1,
  expectedDatabase: { project: 'project-test', branch: 'br-test', role: 'aeo_app', database: 'neondb' },
  capabilities: { claims: 'required', ai: 'unknown', billing: 'verified-disabled', email: 'unknown', scheduler: 'required' },
  relations: [{ schema: 'public', relation: 'clients', privileges: ['SELECT'] }],
}

const expected = { teamId: 'team_test', projectId: 'prj_test', deploymentId: 'dpl_test', commitSha: 'b'.repeat(40), environment: 'preview' as const }
const evidence: RuntimeEvidence = {
  nonce: 'a'.repeat(32), policyHash: hashPolicy(validPolicy), startedAt: '2026-09-08T01:00:00.000Z', completedAt: '2026-09-08T01:00:01.000Z',
  expected,
  observed: { teamId: null, projectId: 'prj_test', deploymentId: 'dpl_test', commitSha: 'b'.repeat(40), environment: 'preview' },
  observedDatabase: { project: 'project-test', branch: null, role: 'aeo_app', database: 'neondb' },
  configuration: buildConfigurationReport([{ id: 'config.VERCEL', status: 'pass', code: 'valid' }]),
  checks: [
    { id: 'candidate.identity', status: 'pass', code: 'matched' },
    { id: 'database.identity', status: 'pass', code: 'matched' },
    { id: 'database.read_only', status: 'pass', code: 'read_only' },
    { id: 'database.relation', status: 'pass', code: 'privilege_present', policyIndex: 0, privilege: 'SELECT' },
    { id: 'auth.jwks', status: 'pass', code: 'available' },
    { id: 'auth.anonymous_session', status: 'pass', code: 'anonymous' },
  ],
}

describe('runtime report', () => {
  it('rebuilds aggregates and always remains advisory', () => {
    const report = buildRuntimeReport(evidence, validPolicy)
    expect(report.runtimeStatus).toBe('unknown')
    expect(report.productionReady).toBe(false)
    expect(report.enforced).toBe(false)
    expect(report.observed.teamId).toBeNull()
  })

  it('treats empty evidence as unknown and failure has precedence', () => {
    expect(buildRuntimeReport({ ...evidence, checks: [] }, validPolicy).runtimeStatus).toBe('unknown')
    expect(buildRuntimeReport({ ...evidence, checks: evidence.checks.slice(0, 1) }, validPolicy).runtimeStatus).toBe('unknown')
    expect(buildRuntimeReport({ ...evidence, checks: [{ id: 'candidate.identity', status: 'unknown', code: 'identity_unavailable' }, { id: 'database.identity', status: 'fail', code: 'identity_mismatch' }] }, validPolicy).runtimeStatus).toBe('fail')
  })

  it.each([
    { ...evidence, startedAt: 'not-a-date' },
    { ...evidence, completedAt: '2026-09-08T00:59:59.000Z' },
    { ...evidence, checks: [{ id: 'sentinel-id', status: 'pass', code: 'matched' }] },
    { ...evidence, checks: [{ id: 'candidate.identity', status: 'pass', code: 'sentinel-code' }] },
    { ...evidence, expected: { ...expected, extra: 'identity-sentinel' } },
    { ...evidence, observedDatabase: { ...evidence.observedDatabase, host: 'db-sentinel' } },
  ])('rejects forged or malformed evidence', (input) => {
    expect(() => buildRuntimeReport(input as never, validPolicy)).toThrow('Invalid runtime evidence')
  })


  it('binds identity claims and policy hash to independently supplied policy context', () => {
    expect(buildRuntimeReport({ ...evidence, observed: { ...evidence.observed, teamId: 'other-team' } }, validPolicy).runtimeStatus).toBe('fail')
    expect(buildRuntimeReport({ ...evidence, observedDatabase: { ...evidence.observedDatabase, branch: 'other-branch' } }, validPolicy).runtimeStatus).toBe('fail')
    expect(() => buildRuntimeReport({ ...evidence, policyHash: '0'.repeat(64) }, validPolicy)).toThrow('Invalid runtime evidence')
  })

  it('requires every policy relation privilege and rejects out-of-policy relation checks', () => {
    const withoutRelation = { ...evidence, observed: expected, observedDatabase: validPolicy.expectedDatabase, checks: evidence.checks.filter((check) => check.id !== 'database.relation') }
    expect(buildRuntimeReport(withoutRelation, validPolicy).runtimeStatus).toBe('unknown')
    expect(() => buildRuntimeReport({ ...evidence, checks: [...evidence.checks, { id: 'database.relation', status: 'pass', code: 'privilege_present', policyIndex: 1, privilege: 'SELECT' }] } as never, validPolicy)).toThrow('Invalid runtime evidence')
    expect(() => buildRuntimeReport({ ...evidence, checks: evidence.checks.map((check) => check.id === 'database.relation' ? { ...check, privilege: 'DELETE' } : check) } as never, validPolicy)).toThrow('Invalid runtime evidence')
  })

  it.each([
    ['nonce', { ...evidence, nonce: 'sentinel' }],
    ['startedAt', { ...evidence, startedAt: 'sentinel' }],
    ['completedAt', { ...evidence, completedAt: 'sentinel' }],
    ['policyHash', { ...evidence, policyHash: 'sentinel' }],
    ['expected', { ...evidence, expected: { ...expected, projectId: 'sentinel!' } }],
    ['observed', { ...evidence, observed: { ...evidence.observed, deploymentId: 'sentinel!' } }],
    ['database', { ...evidence, observedDatabase: { ...evidence.observedDatabase, database: 'sentinel!' } }],
    ['configuration id', { ...evidence, configuration: { ...evidence.configuration, checks: [{ id: 'sentinel', status: 'pass', code: 'valid' }] } }],
    ['configuration status', { ...evidence, configuration: { ...evidence.configuration, checks: [{ id: 'config.VERCEL', status: 'sentinel', code: 'valid' }] } }],
    ['configuration code', { ...evidence, configuration: { ...evidence.configuration, checks: [{ id: 'config.VERCEL', status: 'pass', code: 'sentinel' }] } }],
    ['runtime check status', { ...evidence, checks: [{ id: 'candidate.identity', status: 'sentinel', code: 'matched' }] }],
    ['runtime check id', { ...evidence, checks: [{ id: 'sentinel', status: 'pass', code: 'matched' }] }],
    ['runtime check code', { ...evidence, checks: [{ id: 'candidate.identity', status: 'pass', code: 'sentinel' }] }],
  ])('rejects a sentinel in rendered %s data', (_field, value) => {
    expect(() => buildRuntimeReport(value as never, validPolicy)).toThrow()
  })
  it('renders only canonical allowlisted fields', () => {
    const forged = { ...buildRuntimeReport(evidence, validPolicy), runtimeStatus: 'forged-pass-sentinel', secret: 'report-secret-sentinel' }
    const markdown = renderRuntimeReport(forged as never, validPolicy)
    expect(markdown).toContain('REPORT ONLY / NOT ENFORCED')
    expect(markdown).toContain('Runtime: unknown')
    expect(markdown).not.toContain('sentinel')
    expect(markdown).toContain('teamId: unavailable')
  })
})
