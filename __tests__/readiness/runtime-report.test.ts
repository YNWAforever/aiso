import { describe, expect, it } from 'vitest'

import { buildConfigurationReport } from '@/lib/readiness/report'
import { buildRuntimeReport, renderRuntimeReport, type RuntimeEvidence } from '@/lib/readiness/runtime-report'

const expected = { teamId: 'team_test', projectId: 'prj_test', deploymentId: 'dpl_test', commitSha: 'b'.repeat(40), environment: 'preview' as const }
const evidence: RuntimeEvidence = {
  nonce: 'a'.repeat(32), policyHash: 'c'.repeat(64), startedAt: '2026-09-08T01:00:00.000Z', completedAt: '2026-09-08T01:00:01.000Z',
  expected,
  observed: { teamId: null, projectId: 'prj_test', deploymentId: 'dpl_test', commitSha: 'b'.repeat(40), environment: 'preview' },
  observedDatabase: { project: 'project-test', branch: null, role: 'aeo_app', database: 'neondb' },
  configuration: buildConfigurationReport([{ id: 'config.VERCEL', status: 'pass', code: 'valid' }]),
  checks: [
    { id: 'candidate.identity', status: 'pass', code: 'matched' },
    { id: 'database.identity', status: 'pass', code: 'matched' },
    { id: 'database.read_only', status: 'pass', code: 'read_only' },
    { id: 'auth.jwks', status: 'pass', code: 'available' },
    { id: 'auth.anonymous_session', status: 'pass', code: 'anonymous' },
  ],
}

describe('runtime report', () => {
  it('rebuilds aggregates and always remains advisory', () => {
    const report = buildRuntimeReport(evidence)
    expect(report.runtimeStatus).toBe('pass')
    expect(report.productionReady).toBe(false)
    expect(report.enforced).toBe(false)
    expect(report.observed.teamId).toBeNull()
  })

  it('treats empty evidence as unknown and failure has precedence', () => {
    expect(buildRuntimeReport({ ...evidence, checks: [] }).runtimeStatus).toBe('unknown')
    expect(buildRuntimeReport({ ...evidence, checks: evidence.checks.slice(0, 1) }).runtimeStatus).toBe('unknown')
    expect(buildRuntimeReport({ ...evidence, checks: [{ id: 'candidate.identity', status: 'unknown', code: 'identity_unavailable' }, { id: 'database.identity', status: 'fail', code: 'identity_mismatch' }] }).runtimeStatus).toBe('fail')
  })

  it.each([
    { ...evidence, startedAt: 'not-a-date' },
    { ...evidence, completedAt: '2026-09-08T00:59:59.000Z' },
    { ...evidence, checks: [{ id: 'sentinel-id', status: 'pass', code: 'matched' }] },
    { ...evidence, checks: [{ id: 'candidate.identity', status: 'pass', code: 'sentinel-code' }] },
    { ...evidence, expected: { ...expected, extra: 'identity-sentinel' } },
    { ...evidence, observedDatabase: { ...evidence.observedDatabase, host: 'db-sentinel' } },
  ])('rejects forged or malformed evidence', (input) => {
    expect(() => buildRuntimeReport(input as never)).toThrow('Invalid runtime evidence')
  })

  it('renders only canonical allowlisted fields', () => {
    const forged = { ...buildRuntimeReport(evidence), runtimeStatus: 'forged-pass-sentinel', secret: 'report-secret-sentinel' }
    const markdown = renderRuntimeReport(forged as never)
    expect(markdown).toContain('REPORT ONLY / NOT ENFORCED')
    expect(markdown).toContain('Runtime: pass')
    expect(markdown).not.toContain('sentinel')
    expect(markdown).toContain('teamId: unavailable')
  })
})
