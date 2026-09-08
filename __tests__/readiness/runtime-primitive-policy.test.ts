import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { hashPolicy, parseProbeRequest, type RuntimePolicy } from '@/lib/readiness/runtime-contract'
import { hashPolicy as wireHash } from '../../scripts/readiness/candidate-contract.mjs'
import fixture from '../fixtures/runtime-candidate.json'

export const malformedPolicies = [
  { ...fixture.policy, capabilities: { ...fixture.policy.capabilities, claims: ['required'] } },
  { ...fixture.policy, relations: [{ schema: 'public', relation: ['clients'], privileges: ['SELECT'] }] },
  { ...fixture.policy, relations: [{ schema: 'public', relation: null, privileges: ['SELECT'] }] },
  { ...fixture.policy, relations: [{ schema: 'public', relation: 'clients', privileges: [['SELECT']] }] },
]
function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => `${JSON.stringify(key)}:${canonical(entry)}`).join(',')}}`
  return JSON.stringify(value)
}
export function malformedRequest(policy: unknown) {
  return { schemaVersion: 1, nonce: fixture.report.nonce, expected: fixture.report.expected, policy, policyHash: createHash('sha256').update(canonical(policy)).digest('hex') }
}
describe('primitive policy contract', () => {
  it.each(malformedPolicies)('rejects coercible values in both contracts', policy => {
    expect(() => wireHash(policy)).toThrow()
    expect(() => hashPolicy(policy as unknown as RuntimePolicy)).toThrow()
    expect(() => parseProbeRequest(malformedRequest(policy))).toThrow()
  })
})
