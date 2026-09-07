import { buildConfigurationReport, type ConfigurationReport } from './report'
import { hashPolicy, runtimeCheckCodes, runtimeCheckIds, type CandidateIdentity, type ProbeStatus, type RuntimeCheck, type RuntimePolicy } from './runtime-contract'

export type ObservedCandidateIdentity = { [K in keyof CandidateIdentity]: CandidateIdentity[K] | null }
export type ObservedDatabaseIdentity = { project: string | null; branch: string | null; role: string | null; database: string | null }
export type RuntimeEvidence = {
  nonce: string
  policyHash: string
  startedAt: string
  completedAt: string
  expected: CandidateIdentity
  observed: ObservedCandidateIdentity
  observedDatabase: ObservedDatabaseIdentity
  configuration: ConfigurationReport
  checks: RuntimeCheck[]
}
export type RuntimeReport = RuntimeEvidence & {
  schemaVersion: 1
  kind: 'runtime-readiness'
  enforced: false
  productionReady: false
  configurationStatus: ProbeStatus
  runtimeStatus: ProbeStatus
}

const invalidEvidence = 'Invalid runtime evidence'
const checkIds = new Set<string>(runtimeCheckIds)
const checkCodes = new Set<string>(runtimeCheckCodes)
const statuses = new Set<string>(['pass', 'fail', 'unknown'])
const identityPattern = /^[A-Za-z0-9_-]{1,128}$/
const sqlIdentifier = /^[a-z_][a-z0-9_]{0,127}$/

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value) }
function exact(value: Record<string, unknown>, keys: readonly string[]) { return Object.keys(value).length === keys.length && Object.keys(value).every((key) => keys.includes(key)) }
const requiredRuntimeCheckIds = new Set(['candidate.identity', 'database.identity', 'database.read_only', 'auth.jwks', 'auth.anonymous_session'])
function status(checks: readonly RuntimeCheck[], policy: RuntimePolicy): ProbeStatus {
  if (checks.some((check) => check.status === 'fail')) return 'fail'
  const supplied = new Set<string>(checks.map((check) => check.id))
  const relations = new Set(checks.filter((check) => check.id === 'database.relation').map((check) => String(check.policyIndex) + ':' + check.privilege))
  const missingRelation = policy.relations.some((relation, index) => relation.privileges.some((privilege) => !relations.has(String(index) + ':' + privilege)))
  return checks.some((check) => check.status === 'unknown') || [...requiredRuntimeCheckIds].some((id) => !supplied.has(id)) || missingRelation ? 'unknown' : 'pass'
}

function canonicalIdentityCheck(checks: RuntimeCheck[], id: 'candidate.identity' | 'database.identity', expected: Record<string, unknown>, observed: Record<string, unknown>): RuntimeCheck[] {
  const index = checks.findIndex((check) => check.id === id)
  if (index < 0) return checks
  if (checks[index].status === 'fail') return checks
  const mismatch = Object.keys(expected).some((key) => observed[key] !== null && observed[key] !== expected[key])
  const unavailable = Object.keys(expected).some((key) => observed[key] === null)
  const canonical: RuntimeCheck = mismatch
    ? { id, status: 'fail', code: 'identity_mismatch' }
    : unavailable
      ? { id, status: 'unknown', code: 'identity_unavailable' }
      : { id, status: 'pass', code: 'matched' }
  return checks.map((check, current) => current === index ? canonical : check)
}
function iso(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const time = Date.parse(value)
  return Number.isFinite(time) && new Date(time).toISOString() === value
}

export function parseObservedCandidateIdentity(value: unknown): ObservedCandidateIdentity {
  const parsed = candidate(value, true)
  if (!parsed) throw new Error(invalidEvidence)
  return parsed
}

function candidate(value: unknown, partial: boolean): ObservedCandidateIdentity | undefined {
  const keys = ['teamId', 'projectId', 'deploymentId', 'commitSha', 'environment']
  if (!isRecord(value) || !exact(value, keys)) return
  const validId = (entry: unknown) => partial && entry === null || typeof entry === 'string' && identityPattern.test(entry)
  if (!validId(value.teamId) || !validId(value.projectId) || !validId(value.deploymentId)) return
  if (!(partial && value.commitSha === null) && (typeof value.commitSha !== 'string' || !/^[a-f0-9]{40}$/.test(value.commitSha))) return
  if (!(partial && value.environment === null) && value.environment !== 'preview' && value.environment !== 'production') return
  return value as ObservedCandidateIdentity
}

export function parseObservedDatabaseIdentity(value: unknown): ObservedDatabaseIdentity {
  const parsed = database(value)
  if (!parsed) throw new Error(invalidEvidence)
  return parsed
}

function database(value: unknown): ObservedDatabaseIdentity | undefined {
  const keys = ['project', 'branch', 'role', 'database']
  if (!isRecord(value) || !exact(value, keys)) return
  if (![value.project, value.branch].every((entry) => entry === null || typeof entry === 'string' && identityPattern.test(entry))) return
  if (![value.role, value.database].every((entry) => entry === null || typeof entry === 'string' && sqlIdentifier.test(entry))) return
  return value as ObservedDatabaseIdentity
}

export function parseRuntimeChecks(value: unknown, policy: RuntimePolicy): RuntimeCheck[] {
  if (!Array.isArray(value)) throw new Error(invalidEvidence)
  const result: RuntimeCheck[] = []
  const identities = new Set<string>()
  for (const check of value) {
    if (!isRecord(check) || !checkIds.has(String(check.id)) || !statuses.has(String(check.status)) || !checkCodes.has(String(check.code))) throw new Error(invalidEvidence)
    if (check.id === 'database.relation') {
      if (!exact(check, ['id', 'status', 'code', 'policyIndex', 'privilege']) || !Number.isInteger(check.policyIndex) || !policy.relations[Number(check.policyIndex)]?.privileges.includes(check.privilege as never)) throw new Error(invalidEvidence)
      const identity = `${check.policyIndex}:${check.privilege}`
      if (identities.has(identity)) throw new Error(invalidEvidence)
      identities.add(identity)
      result.push({ id: 'database.relation', status: check.status as ProbeStatus, code: check.code as RuntimeCheck['code'], policyIndex: Number(check.policyIndex), privilege: check.privilege as 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' })
    } else {
      if (!exact(check, ['id', 'status', 'code']) || identities.has(String(check.id))) throw new Error(invalidEvidence)
      identities.add(String(check.id))
      result.push({ id: check.id as Exclude<RuntimeCheck['id'], 'database.relation'>, status: check.status as ProbeStatus, code: check.code as RuntimeCheck['code'] })
    }
  }
  return result
}

export function buildRuntimeReport(evidence: RuntimeEvidence, policy: RuntimePolicy): RuntimeReport {
  if (!isRecord(evidence) || !exact(evidence, ['nonce', 'policyHash', 'startedAt', 'completedAt', 'expected', 'observed', 'observedDatabase', 'configuration', 'checks'])) throw new Error(invalidEvidence)
  if (typeof evidence.nonce !== 'string' || !/^[a-f0-9]{32}$/.test(evidence.nonce) || typeof evidence.policyHash !== 'string' || !/^[a-f0-9]{64}$/.test(evidence.policyHash)) throw new Error(invalidEvidence)
  let validatedPolicyHash: string
  try { validatedPolicyHash = hashPolicy(policy) } catch { throw new Error(invalidEvidence) }
  if (validatedPolicyHash !== evidence.policyHash) throw new Error(invalidEvidence)
  if (!iso(evidence.startedAt) || !iso(evidence.completedAt) || Date.parse(evidence.completedAt) < Date.parse(evidence.startedAt)) throw new Error(invalidEvidence)
  const expected = candidate(evidence.expected, false)
  const observed = candidate(evidence.observed, true)
  const observedDatabase = database(evidence.observedDatabase)
  let checks: RuntimeCheck[]
  try { checks = parseRuntimeChecks(evidence.checks, policy) } catch { throw new Error(invalidEvidence) }
  if (!expected || !observed || !observedDatabase) throw new Error(invalidEvidence)
  checks = canonicalIdentityCheck(checks, 'candidate.identity', expected as Record<string, unknown>, observed as Record<string, unknown>)
  checks = canonicalIdentityCheck(checks, 'database.identity', policy.expectedDatabase, observedDatabase)
  let configuration: ConfigurationReport
  try { configuration = buildConfigurationReport(evidence.configuration.checks) } catch { throw new Error(invalidEvidence) }
  return {
    schemaVersion: 1, kind: 'runtime-readiness', enforced: false, productionReady: false,
    nonce: evidence.nonce, policyHash: evidence.policyHash, startedAt: evidence.startedAt, completedAt: evidence.completedAt,
    expected: expected as CandidateIdentity, observed, observedDatabase, configuration,
    configurationStatus: configuration.configurationStatus, runtimeStatus: status(checks, policy), checks,
  }
}

export function renderRuntimeReport(report: RuntimeReport, policy: RuntimePolicy): string {
  const canonical = buildRuntimeReport({ nonce: report.nonce, policyHash: report.policyHash, startedAt: report.startedAt, completedAt: report.completedAt, expected: report.expected, observed: report.observed, observedDatabase: report.observedDatabase, configuration: report.configuration, checks: report.checks }, policy)
  const show = (value: string | null) => value ?? 'unavailable'
  return [
    '# AISO runtime readiness', '', 'REPORT ONLY / NOT ENFORCED', '',
    `Runtime: ${canonical.runtimeStatus}`, `Configuration: ${canonical.configurationStatus}`, 'Production readiness: unverified',
    `Nonce: ${canonical.nonce}`, `Policy hash: ${canonical.policyHash}`, `Started: ${canonical.startedAt}`, `Completed: ${canonical.completedAt}`, '',
    '## Expected candidate', ...Object.entries(canonical.expected).map(([key, value]) => `- ${key}: ${value}`), '',
    '## Observed candidate', ...Object.entries(canonical.observed).map(([key, value]) => `- ${key}: ${show(value)}`), '',
    '## Observed database', ...Object.entries(canonical.observedDatabase).map(([key, value]) => `- ${key}: ${show(value)}`), '',
    '## Configuration checks', ...canonical.configuration.checks.map((check) => `- ${check.id}: ${check.status} (${check.code})`), '',
    '## Runtime checks', ...canonical.checks.map((check) => `- ${check.id}: ${check.status} (${check.code})`), '',
  ].join('\n')
}
