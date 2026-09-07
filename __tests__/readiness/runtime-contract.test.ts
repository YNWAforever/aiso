import { describe, expect, it } from 'vitest'

import { hashPolicy, parseProbeRequest, type ProbeRequest, type RuntimePolicy } from '@/lib/readiness/runtime-contract'

export const validPolicy: RuntimePolicy = {
  version: 1,
  expectedDatabase: { project: 'project-test', branch: 'br-test', role: 'aeo_app', database: 'neondb' },
  capabilities: { claims: 'required', ai: 'unknown', billing: 'verified-disabled', email: 'unknown', scheduler: 'required' },
  relations: [{ schema: 'public', relation: 'clients', privileges: ['SELECT'] }],
}

export function requestFor(policy: RuntimePolicy = validPolicy): ProbeRequest {
  return {
    schemaVersion: 1,
    nonce: 'a'.repeat(32),
    expected: { teamId: 'team_test', projectId: 'prj_test', deploymentId: 'dpl_test', commitSha: 'b'.repeat(40), environment: 'preview' },
    policyHash: hashPolicy(policy),
    policy,
  }
}

describe('runtime request contract', () => {
  it('accepts and returns an allowlisted request', () => {
    expect(parseProbeRequest(requestFor())).toEqual(requestFor())
  })

  it.each([
    (value: ProbeRequest) => ({ ...value, sql: 'select 1' }),
    (value: ProbeRequest) => ({ ...value, nonce: 'A'.repeat(32) }),
    (value: ProbeRequest) => ({ ...value, expected: { ...value.expected, commitSha: 'a'.repeat(39) } }),
    (value: ProbeRequest) => ({ ...value, expected: { ...value.expected, teamId: '' } }),
    (value: ProbeRequest) => ({ ...value, expected: { ...value.expected, projectId: 'x'.repeat(129) } }),
    (value: ProbeRequest) => ({ ...value, policy: { ...value.policy, extra: true } }),
    (value: ProbeRequest) => ({ ...value, policy: { ...value.policy, capabilities: { ...value.policy.capabilities, ai: 'disabled' } } }),
    (value: ProbeRequest) => ({ ...value, policy: { ...value.policy, relations: [{ schema: 'public', relation: 'Bad-Name', privileges: ['SELECT'] }] } }),
    (value: ProbeRequest) => ({ ...value, policy: { ...value.policy, relations: [{ schema: 'public', relation: 'clients', privileges: ['DROP'] }] } }),
    (value: ProbeRequest) => ({ ...value, policy: { ...value.policy, relations: [{ schema: 'public', relation: 'clients', privileges: ['SELECT', 'SELECT'] }] } }),
    (value: ProbeRequest) => ({ ...value, policy: { ...value.policy, relations: [value.policy.relations[0], value.policy.relations[0]] } }),
    (value: ProbeRequest) => ({ ...value, policyHash: '0'.repeat(64) }),
  ])('rejects malformed, unknown, duplicate or mismatched input', (mutate) => {
    expect(() => parseProbeRequest(mutate(requestFor()) as never)).toThrow('Invalid readiness request')
  })

  it('bounds policy relations', () => {
    const request = { ...requestFor(), policy: { ...validPolicy, relations: Array.from({ length: 33 }, (_, i) => ({ schema: 'public' as const, relation: 'table_' + i, privileges: ['SELECT' as const] })) } }
    expect(() => parseProbeRequest(request)).toThrow('Invalid readiness request')
  })


  it('rejects oversized policies through bounded relation and identifier fields', () => {
    const oversized = { ...validPolicy, relations: [{ schema: 'public' as const, relation: 'x'.repeat(129), privileges: ['SELECT' as const] }] }
    expect(() => hashPolicy(oversized)).toThrow('Invalid readiness request')
  })
  it('canonicalizes object keys while preserving array order', () => {
    const reordered = { relations: validPolicy.relations, capabilities: validPolicy.capabilities, expectedDatabase: validPolicy.expectedDatabase, version: 1 } as RuntimePolicy
    expect(hashPolicy(reordered)).toBe(hashPolicy(validPolicy))
    expect(hashPolicy({ ...validPolicy, relations: [{ ...validPolicy.relations[0], privileges: ['UPDATE', 'SELECT'] }] })).not.toBe(hashPolicy({ ...validPolicy, relations: [{ ...validPolicy.relations[0], privileges: ['SELECT', 'UPDATE'] }] }))
  })
})
