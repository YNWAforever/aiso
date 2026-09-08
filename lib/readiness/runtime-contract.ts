import { createHash } from 'node:crypto'

import { capabilityNames, type ReleasePolicy } from './config'

export type ProbeStatus = 'pass' | 'fail' | 'unknown'
export type CandidateIdentity = {
  teamId: string
  projectId: string
  deploymentId: string
  commitSha: string
  environment: 'preview' | 'production'
}
export type MetadataRequirement = {
  schema: 'public'
  relation: string
  privileges: ('SELECT' | 'INSERT' | 'UPDATE' | 'DELETE')[]
}
export type RuntimePolicy = {
  version: 1
  expectedDatabase: { project: string; branch: string; role: 'aeo_app'; database: string }
  capabilities: Record<'claims' | 'ai' | 'billing' | 'email' | 'scheduler', 'required' | 'unknown' | 'verified-disabled'>
  relations: MetadataRequirement[]
}
export type ProbeRequest = {
  schemaVersion: 1
  nonce: string
  expected: CandidateIdentity
  policyHash: string
  policy: RuntimePolicy
}

export const runtimeCheckIds = [
  'candidate.identity',
  'configuration.core',
  'database.identity',
  'database.read_only',
  'database.relation',
  'auth.jwks',
  'auth.anonymous_session',
] as const

export const runtimeCheckCodes = [
  'matched',
  'identity_unavailable',
  'identity_mismatch',
  'valid',
  'invalid',
  'dependency_failed',
  'connected',
  'connection_failed',
  'read_only',
  'read_only_unverified',
  'relation_present',
  'relation_missing',
  'privilege_present',
  'privilege_missing',
  'available',
  'unavailable',
  'anonymous',
  'session_present',
  'malformed_response',
  'timeout',
  'probe_error',
] as const

export type RuntimeCheckId = (typeof runtimeCheckIds)[number]
export type RuntimeCheckCode = (typeof runtimeCheckCodes)[number]
export type RuntimeCheck =
  | { id: Exclude<RuntimeCheckId, 'database.relation'>; status: ProbeStatus; code: RuntimeCheckCode }
  | { id: 'database.relation'; status: ProbeStatus; code: RuntimeCheckCode; policyIndex: number; privilege: MetadataRequirement['privileges'][number] }

const invalidRequest = 'Invalid readiness request'
const candidateKeys = ['teamId', 'projectId', 'deploymentId', 'commitSha', 'environment'] as const
const policyKeys = ['version', 'expectedDatabase', 'capabilities', 'relations'] as const
const databaseKeys = ['project', 'branch', 'role', 'database'] as const
const capabilityModes = new Set(['required', 'unknown', 'verified-disabled'])
const privilegeNames = new Set(['SELECT', 'INSERT', 'UPDATE', 'DELETE'])
const sqlIdentifier = /^[a-z_][a-z0-9_]{0,127}$/
const externalIdentifier = /^[A-Za-z0-9_-]{1,128}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Object.keys(value)
  return actual.length === keys.length && actual.every((key) => keys.includes(key))
}

function parseCandidate(value: unknown): CandidateIdentity | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, candidateKeys)) return
  if (typeof value.teamId !== 'string' || typeof value.projectId !== 'string' || typeof value.deploymentId !== 'string' || !externalIdentifier.test(value.teamId) || !externalIdentifier.test(value.projectId) || !externalIdentifier.test(value.deploymentId)) return
  if (typeof value.commitSha !== 'string' || !/^[a-f0-9]{40}$/.test(value.commitSha)) return
  if (value.environment !== 'preview' && value.environment !== 'production') return
  return { teamId: String(value.teamId), projectId: String(value.projectId), deploymentId: String(value.deploymentId), commitSha: value.commitSha, environment: value.environment }
}

function parsePolicy(value: unknown): RuntimePolicy | undefined {
  if (!isRecord(value) || !hasOnlyKeys(value, policyKeys) || value.version !== 1) return
  const expected = value.expectedDatabase
  const capabilities = value.capabilities
  const relations = value.relations
  if (!isRecord(expected) || !hasOnlyKeys(expected, databaseKeys)) return
  if (typeof expected.project !== 'string' || typeof expected.branch !== 'string' || typeof expected.database !== 'string' || !externalIdentifier.test(expected.project) || !externalIdentifier.test(expected.branch) || expected.role !== 'aeo_app' || !sqlIdentifier.test(expected.database)) return
  if (!isRecord(capabilities) || !hasOnlyKeys(capabilities, capabilityNames)) return
  if (capabilityNames.some((name) => typeof capabilities[name] !== 'string' || !capabilityModes.has(capabilities[name]))) return
  if (!Array.isArray(relations) || relations.length > 32) return

  const parsedRelations: MetadataRequirement[] = []
  const relationNames = new Set<string>()
  for (const relation of relations) {
    if (!isRecord(relation) || !hasOnlyKeys(relation, ['schema', 'relation', 'privileges']) || relation.schema !== 'public' || typeof relation.relation !== 'string' || !sqlIdentifier.test(relation.relation)) return
    if (!Array.isArray(relation.privileges) || relation.privileges.length > 4 || relation.privileges.length === 0) return
    if (relation.privileges.some((privilege: unknown) => typeof privilege !== 'string')) return
    const privileges = relation.privileges as string[]
    if (privileges.some((privilege) => !privilegeNames.has(privilege)) || new Set(privileges).size !== privileges.length || relationNames.has(String(relation.relation))) return
    relationNames.add(String(relation.relation))
    parsedRelations.push({ schema: 'public', relation: String(relation.relation), privileges: privileges as MetadataRequirement['privileges'] })
  }

  return {
    version: 1,
    expectedDatabase: { project: String(expected.project), branch: String(expected.branch), role: 'aeo_app', database: String(expected.database) },
    capabilities: Object.fromEntries(capabilityNames.map((name) => [name, capabilities[name]])) as RuntimePolicy['capabilities'],
    relations: parsedRelations,
  }
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (isRecord(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`
  return JSON.stringify(value)
}

export function hashPolicy(policy: RuntimePolicy): string {
  const safe = parsePolicy(policy)
  if (!safe) throw new Error(invalidRequest)
  return createHash('sha256').update(canonicalJson(safe), 'utf8').digest('hex')
}

export function parseProbeRequest(input: unknown): ProbeRequest {
  if (!isRecord(input) || !hasOnlyKeys(input, ['schemaVersion', 'nonce', 'expected', 'policyHash', 'policy']) || input.schemaVersion !== 1) throw new Error(invalidRequest)
  if (typeof input.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(input.nonce) || typeof input.policyHash !== 'string' || !/^[a-f0-9]{64}$/.test(input.policyHash)) throw new Error(invalidRequest)
  const expected = parseCandidate(input.expected)
  const policy = parsePolicy(input.policy)
  if (!expected || !policy || canonicalJson(policy).length > 16 * 1024 || hashPolicy(policy) !== input.policyHash) throw new Error(invalidRequest)
  return { schemaVersion: 1, nonce: input.nonce, expected, policyHash: input.policyHash, policy }
}

export function toReleasePolicy(policy: RuntimePolicy): ReleasePolicy {
  return {
    expected: { ...policy.expectedDatabase },
    capabilities: Object.fromEntries(capabilityNames.map((name) => [name, policy.capabilities[name] === 'verified-disabled' ? 'unknown' : policy.capabilities[name]])) as ReleasePolicy['capabilities'],
  }
}
