import { describe, expect, it } from 'vitest'
import fixture from '../fixtures/runtime-candidate.json'
import { buildRuntimeReport, type RuntimeEvidence } from '@/lib/readiness/runtime-report'
import { hashPolicy, runtimeCheckCodes, runtimeCheckIds, type RuntimePolicy } from '@/lib/readiness/runtime-contract'
import { configurationCheckCodes, configurationCheckIds, configurationCheckStatuses } from '@/lib/readiness/config'
// Plain Node wire validation deliberately has no runtime TypeScript/alias imports.
// JavaScript declarations are inferred by the repository compiler.
import { validateReport, hashPolicy as wireHash, wireVocabulary } from '../../scripts/readiness/candidate-contract.mjs'

function evidence(): RuntimeEvidence {
  const r = fixture.report
  return { nonce: r.nonce, policyHash: r.policyHash, startedAt: r.startedAt, completedAt: r.completedAt, expected: r.expected, observed: r.observed, configuredTeamId: r.configuredTeamId, observedDatabase: r.observedDatabase, configuration: r.configuration, checks: r.checks } as RuntimeEvidence
}
describe('candidate runner and application wire contract', () => {
  const policy = fixture.policy as RuntimePolicy
  it('rebuilds the shared synthetic response through the actual application builder', () => {
    const report = buildRuntimeReport(evidence(), policy)
    expect(report).toEqual(fixture.report)
    expect(wireHash(policy)).toBe(hashPolicy(policy))
    expect(validateReport(report, { expected: report.expected, nonce: report.nonce, policy, now: Date.parse('2026-09-08T01:00:02.000Z') })).toEqual(report)
  })
  it('pins every finite wire vocabulary to application exports', () => {
    const sorted = (v: readonly string[]) => [...v].sort()
    expect(sorted(wireVocabulary.configurationIds)).toEqual(sorted(configurationCheckIds))
    expect(sorted(wireVocabulary.configCodes)).toEqual(sorted(configurationCheckCodes))
    expect(sorted(wireVocabulary.runtimeIds)).toEqual(sorted(runtimeCheckIds))
    expect(sorted(wireVocabulary.runtimeCodes)).toEqual(sorted(runtimeCheckCodes))
    expect(sorted(wireVocabulary.statuses)).toEqual(sorted(configurationCheckStatuses))
  })
  it.each(['fail', 'unknown'] as const)('accepts honest builder %s database identity evidence', status => {
    const original = evidence()
    const report = buildRuntimeReport({
      ...original,
      observedDatabase: { ...original.observedDatabase, branch: status === 'fail' ? 'different-branch' : null },
      checks: original.checks.map(c => c.id === 'database.identity' ? { ...c, status, code: status === 'fail' ? 'identity_mismatch' : 'identity_unavailable' } : c),
    }, policy)
    expect(validateReport(report, { expected: report.expected, nonce: report.nonce, policy, now: Date.parse('2026-09-08T01:00:02.000Z') })).toEqual(report)
  })
})