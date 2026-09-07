import { configurationCheckIds, type ConfigCheck, type ConfigurationCheckId } from './config'
import { buildConfigurationReport } from './report'
import { parseProbeRequest, type ProbeRequest, type RuntimeCheck, type RuntimePolicy } from './runtime-contract'
import { buildRuntimeReport, parseObservedCandidateIdentity, parseObservedDatabaseIdentity, parseRuntimeChecks, type ObservedCandidateIdentity, type ObservedDatabaseIdentity, type RuntimeReport } from './runtime-report'

export type IdentityPortOutput = ObservedCandidateIdentity
export type ConfigurationPortOutput = ConfigCheck[]
export type DatabaseCheck = RuntimeCheck & { id: 'database.identity' | 'database.read_only' | 'database.relation' }
export type DatabasePortOutput = { observedDatabase: ObservedDatabaseIdentity; checks: DatabaseCheck[] }
export type AuthCheck = RuntimeCheck & { id: 'auth.jwks' | 'auth.anonymous_session' }
export type AuthPortOutput = AuthCheck[]
export type ProbePorts = {
  now(): number
  configuredTeam?(): unknown
  identity(): unknown
  configuration(policy: RuntimePolicy): unknown
  database(policy: RuntimePolicy, signal: AbortSignal): Promise<unknown>
  auth(policy: RuntimePolicy, signal: AbortSignal): Promise<unknown>
}

const emptyCandidate = (): ObservedCandidateIdentity => ({ teamId: null, projectId: null, deploymentId: null, commitSha: null, environment: null })
const emptyDatabase = (): ObservedDatabaseIdentity => ({ project: null, branch: null, role: null, database: null })
const dbDependencies: ConfigurationCheckId[] = ['config.DATABASE_URL', ...configurationCheckIds.filter(id => id.startsWith('binding.'))]
const authDependencies: ConfigurationCheckId[] = ['config.NEON_AUTH_BASE_URL', 'config.NEON_AUTH_COOKIE_SECRET']
const coreDependencies: ConfigurationCheckId[] = ['config.DATABASE_URL', ...authDependencies, 'config.PUBLIC_SCAN_RATE_LIMIT_SECRET', 'config.NEXT_PUBLIC_APP_URL', 'config.VERCEL']
const optionalDependencies = {
  claims: ['config.REPORT_SHARE_SECRET'],
  ai: ['config.OPENROUTER_API_KEY'],
  billing: ['config.STRIPE_SECRET_KEY', 'config.STRIPE_WEBHOOK_SECRET', 'config.STRIPE_PRICE_BASIC', 'config.STRIPE_PRICE_PRO', 'config.STRIPE_PRICE_ENTERPRISE'],
  email: ['config.RESEND_API_KEY', 'config.RESEND_FROM_EMAIL', 'config.RESEND_TRIAL_FROM_EMAIL'],
  scheduler: ['config.CRON_SECRET'],
} as const

function configuration(value: unknown, policy: RuntimePolicy) {
  if (!Array.isArray(value)) throw new Error('Invalid configuration')
  const report = buildConfigurationReport(value)
  const ids = new Set(report.checks.map(check => check.id))
  if (ids.size !== report.checks.length) throw new Error('Invalid configuration')
  const required: ConfigurationCheckId[] = [...coreDependencies, ...dbDependencies, ...configurationCheckIds.filter(id => id.startsWith('capability.'))]
  for (const key of Object.keys(optionalDependencies) as (keyof typeof optionalDependencies)[]) {
    if (policy.capabilities[key] === 'required') required.push(...optionalDependencies[key])
  }
  for (const id of new Set(required)) if (!ids.has(id)) report.checks.push({ id, status: 'unknown', code: 'unknown' })
  return buildConfigurationReport(report.checks)
}

function scope(parent: AbortSignal, milliseconds: number) {
  const controller = new AbortController()
  const abort = () => controller.abort()
  parent.addEventListener('abort', abort, { once: true })
  const timer = setTimeout(abort, Math.max(0, milliseconds))
  if (parent.aborted || milliseconds <= 0) abort()
  return { signal: controller.signal, dispose() { clearTimeout(timer); parent.removeEventListener('abort', abort) } }
}

type Outcome = { kind: 'value'; value: unknown } | { kind: 'timeout' | 'error' }
async function bounded(call: (signal: AbortSignal) => Promise<unknown>, parent: AbortSignal, remaining: number): Promise<Outcome> {
  const probe = scope(parent, Math.min(5000, remaining))
  let onAbort: () => void = () => {}
  try {
    if (probe.signal.aborted) return { kind: 'timeout' }
    const cancelled = new Promise<Outcome>(resolve => {
      onAbort = () => resolve({ kind: 'timeout' })
      probe.signal.addEventListener('abort', onAbort, { once: true })
    })
    // Install rejection handling immediately, including for adapters that settle after cancellation.
    const operation: Promise<Outcome> = Promise.resolve().then<Outcome>(() => {
      if (probe.signal.aborted) return { kind: 'timeout' } as const
      return call(probe.signal).then(value => ({ kind: 'value', value }) as const)
    }).catch(() => ({ kind: probe.signal.aborted ? 'timeout' : 'error' }))
    return await Promise.race([cancelled, operation])
  } finally {
    probe.signal.removeEventListener('abort', onAbort)
    probe.dispose()
  }
}

function categoryChecks(value: unknown, policy: RuntimePolicy, category: 'database.' | 'auth.') {
  const checks = parseRuntimeChecks(value, policy)
  if (checks.some(check => !check.id.startsWith(category))) throw new Error('Invalid probe category')
  return checks
}

/** Local observations only. Adapters must stop their I/O when their signal aborts. */
export async function runRuntimeProbe(input: ProbeRequest, ports: ProbePorts, signal: AbortSignal): Promise<RuntimeReport> {
  if (signal.aborted) throw new Error('Readiness probe aborted')
  const request = parseProbeRequest(input)
  const started = ports.now()
  const deadline = started + 15000
  const shared = scope(signal, 15000)
  const remaining = () => deadline - ports.now()
  const checks: RuntimeCheck[] = []
  let configuredTeamId: string | null | undefined
  let observed = emptyCandidate()
  let observedDatabase = emptyDatabase()
  let config = buildConfigurationReport([])
  const fallback = (id: 'database.identity' | 'auth.jwks', code: RuntimeCheck['code']): RuntimeCheck => ({ id, status: 'unknown', code })
  try {
    try {
      observed = { ...parseObservedCandidateIdentity(ports.identity()) }
      if (ports.configuredTeam) {
        const value = ports.configuredTeam()
        configuredTeamId = typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value) ? value : null
      }
      const identityForComparison = configuredTeamId !== undefined ? { ...observed, teamId: configuredTeamId } : observed
      const mismatch = (observed.teamId !== null && observed.teamId !== request.expected.teamId) || Object.keys(request.expected).some(key => identityForComparison[key as keyof typeof identityForComparison] !== null && identityForComparison[key as keyof typeof identityForComparison] !== request.expected[key as keyof typeof request.expected])
      const missing = Object.values(identityForComparison).some(value => value === null)
      checks.push({ id: 'candidate.identity', status: mismatch ? 'fail' : missing ? 'unknown' : 'pass', code: mismatch ? 'identity_mismatch' : missing ? 'identity_unavailable' : 'matched' })
    } catch { checks.push({ id: 'candidate.identity', status: 'unknown', code: 'identity_unavailable' }) }
    if (!shared.signal.aborted && remaining() > 0) {
      try { config = configuration(ports.configuration(structuredClone(request.policy)), request.policy) }
      catch { config = buildConfigurationReport([]) }
    }
    checks.push({ id: 'configuration.core', status: config.configurationStatus, code: config.configurationStatus === 'pass' ? 'valid' : config.configurationStatus === 'fail' ? 'invalid' : 'malformed_response' })
    const allowed = (ids: ConfigurationCheckId[]) => ids.every(id => config.checks.some(check => check.id === id && check.status === 'pass'))
    const identityReady = checks[0].status === 'pass'
    const run = (category: 'database' | 'auth', dependencies: ConfigurationCheckId[]): Promise<Outcome> => {
      const id = category === 'database' ? 'database.identity' : 'auth.jwks'
      if (!identityReady || !allowed(dependencies)) {
        checks.push(fallback(id, 'dependency_failed'))
        return Promise.resolve({ kind: 'value', value: null })
      }
      return bounded(probeSignal => ports[category](structuredClone(request.policy), probeSignal), shared.signal, remaining())
    }
    const results = await Promise.allSettled([run('database', dbDependencies), run('auth', authDependencies)])
    for (const [index, result] of results.entries()) {
      const id = index === 0 ? 'database.identity' : 'auth.jwks'
      if (checks.some(check => check.id === id)) continue
      const outcome: Outcome = result.status === 'fulfilled' ? result.value : { kind: 'error' }
      if (outcome.kind !== 'value') {
        checks.push(fallback(id, outcome.kind === 'timeout' ? 'timeout' : index === 0 ? 'connection_failed' : 'unavailable'))
        continue
      }
      try {
        if (index === 0) {
          const value = outcome.value
          if (typeof value !== 'object' || value === null || Array.isArray(value) || Object.keys(value).length !== 2 || !('observedDatabase' in value) || !('checks' in value)) throw new Error('Invalid database evidence')
          const identity = parseObservedDatabaseIdentity(value.observedDatabase)
          const parsed = categoryChecks(value.checks, request.policy, 'database.')
          observedDatabase = { ...identity }
          checks.push(...parsed)
        } else checks.push(...categoryChecks(outcome.value, request.policy, 'auth.'))
      } catch { checks.push(fallback(id, 'malformed_response')) }
    }
    return buildRuntimeReport({
      nonce: request.nonce, policyHash: request.policyHash, expected: request.expected, observed, observedDatabase, ...(configuredTeamId !== undefined ? { configuredTeamId } : {}),
      startedAt: new Date(started).toISOString(), completedAt: new Date(Math.max(started, ports.now())).toISOString(),
      configuration: config, checks,
    }, request.policy)
  } finally { shared.dispose() }
}
