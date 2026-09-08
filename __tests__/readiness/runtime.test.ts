import { afterEach, describe, expect, it, vi } from 'vitest'
import { configurationCheckIds, type ConfigCheck } from '@/lib/readiness/config'
import { hashPolicy, type ProbeRequest, type RuntimePolicy } from '@/lib/readiness/runtime-contract'
import { runRuntimeProbe, type ProbePorts } from '@/lib/readiness/runtime'

const policy: RuntimePolicy = {
  version: 1, expectedDatabase: { project: 'project-test', branch: 'br-test', role: 'aeo_app', database: 'neondb' },
  capabilities: { claims: 'unknown', ai: 'unknown', billing: 'unknown', email: 'unknown', scheduler: 'unknown' },
  relations: [{ schema: 'public', relation: 'clients', privileges: ['SELECT'] }],
}
const expected = { teamId: 'team_test', projectId: 'prj_test', deploymentId: 'dpl_test', commitSha: 'b'.repeat(40), environment: 'preview' as const }
const request: ProbeRequest = { schemaVersion: 1, nonce: 'a'.repeat(32), expected, policyHash: hashPolicy(policy), policy }
const config: ConfigCheck[] = configurationCheckIds.map(id => ({ id, status: 'pass', code: 'valid' }))
const db = { observedDatabase: policy.expectedDatabase, checks: [
  { id: 'database.identity', status: 'pass', code: 'matched' },
  { id: 'database.read_only', status: 'pass', code: 'read_only' },
  { id: 'database.relation', policyIndex: 0, privilege: 'SELECT', status: 'pass', code: 'privilege_present' },
] }
const auth = [{ id: 'auth.jwks', status: 'pass', code: 'available' }, { id: 'auth.anonymous_session', status: 'pass', code: 'anonymous' }]
function ports() {
  return { now: vi.fn(() => Date.now()), identity: vi.fn(() => expected), configuration: vi.fn(() => config),
    database: vi.fn(async () => db), auth: vi.fn(async () => auth) }
}
const run = (p: ProbePorts, signal = new AbortController().signal) => runRuntimeProbe(request, p, signal)
afterEach(() => vi.useRealTimers())
describe('runtime orchestration', () => {
  it('runs each port once and stays advisory', async () => {
    const p = ports(); const result = await run(p)
    expect(result.runtimeStatus).toBe('pass')
    expect(result.productionReady).toBe(false)
    for (const key of ['identity', 'configuration', 'database', 'auth'] as const) expect(p[key]).toHaveBeenCalledTimes(1)
    expect(p.database.mock.calls[0]).toEqual([policy, expect.any(AbortSignal)])
  })
  it.each([{ ...expected, commitSha: 'c'.repeat(40) }, { ...expected, teamId: null }, { raw: 'sentinel' }])('suppresses resources for unverified identity', async identity => {
    const p = ports(); p.identity.mockReturnValue(identity as never)
    const result = await run(p)
    expect(p.database).not.toHaveBeenCalled(); expect(p.auth).not.toHaveBeenCalled()
    expect(result.runtimeStatus).not.toBe('pass')
  })
  it('invalid database configuration suppresses only database', async () => {
    const p = ports(); p.configuration.mockReturnValue(config.map(c => c.id === 'config.DATABASE_URL' ? { ...c, status: 'fail' } : c))
    const result = await run(p)
    expect(p.database).not.toHaveBeenCalled(); expect(p.auth).toHaveBeenCalledOnce()
    expect(result.checks).toContainEqual({ id: 'database.identity', status: 'unknown', code: 'dependency_failed' })
  })
  it('missing configuration never enables I/O', async () => {
    const p = ports(); p.configuration.mockReturnValue([])
    expect((await run(p)).configurationStatus).toBe('unknown')
    expect(p.database).not.toHaveBeenCalled(); expect(p.auth).not.toHaveBeenCalled()
  })
  it('contains exceptions while independent auth completes', async () => {
    const p = ports(); p.database.mockRejectedValue(new Error('secret-sentinel'))
    const result = await run(p)
    expect(p.auth).toHaveBeenCalledOnce(); expect(JSON.stringify(result)).not.toContain('secret-sentinel')
    expect(result.checks).toContainEqual({ id: 'database.identity', status: 'unknown', code: 'connection_failed' })
  })
  it.each([undefined, {}, { ...db, checks: auth }, { ...db, checks: [...db.checks, { id: 'candidate.identity', status: 'pass', code: 'matched' }] }])('rejects malformed and cross-port database results', async value => {
    const p = ports(); p.database.mockResolvedValue(value as never)
    const result = await run(p)
    expect(result.runtimeStatus).toBe('unknown')
    expect(result.checks.filter(c => c.id === 'candidate.identity')).toHaveLength(1)
  })
  it('rejects replacement configuration and auth checks', async () => {
    const p = ports(); p.auth.mockResolvedValue(db.checks as never)
    expect((await run(p)).runtimeStatus).toBe('unknown')
    p.configuration.mockReturnValue([...config, config[0]])
    expect((await run(p)).configurationStatus).toBe('unknown')
  })
  it('missing required check evidence remains unknown', async () => {
    const p = ports(); p.database.mockResolvedValue({ ...db, checks: db.checks.slice(0, 1) })
    expect((await run(p)).runtimeStatus).toBe('unknown')
  })
  it('rejects prior cancellation before any port access', async () => {
    const p = ports(); const controller = new AbortController(); controller.abort('secret-sentinel')
    await expect(run(p, controller.signal)).rejects.toThrow('Readiness probe aborted')
    for (const port of Object.values(p)) expect(port).not.toHaveBeenCalled()
  })
  it.each(['timeout', 'caller'] as const)('aborts both deferred probes and cleans timers on %s', async mode => {
    vi.useFakeTimers(); const p = ports(); const signals: AbortSignal[] = []
    const pending = (_: RuntimePolicy, signal: AbortSignal) => new Promise<unknown>((_resolve, reject) => {
      signals.push(signal); signal.addEventListener('abort', () => reject(new Error('secret-sentinel')), { once: true })
    })
    const controller = new AbortController()
    const resultPromise = run({ ...p, database: vi.fn(pending), auth: vi.fn(pending) }, controller.signal)
    await vi.advanceTimersByTimeAsync(0)
    expect(signals).toHaveLength(2)
    if (mode === 'caller') controller.abort('secret-sentinel')
    else await vi.advanceTimersByTimeAsync(5000)
    const result = await resultPromise
    expect(signals.every(s => s.aborted)).toBe(true)
    expect(result.runtimeStatus).toBe('unknown')
    expect(JSON.stringify(result)).not.toContain('secret-sentinel')
    expect(vi.getTimerCount()).toBe(0)
  })
  it('uses the remaining shared budget after synchronous configuration', async () => {
    vi.useFakeTimers(); let time = Date.now(); const p = ports()
    p.now.mockImplementation(() => time)
    p.configuration.mockImplementation(() => { time += 14000; return config })
    let observed: AbortSignal | undefined
    const resultPromise = run({ ...p, database: (_policy, signal) => { observed = signal; return new Promise(() => {}) } })
    await vi.advanceTimersByTimeAsync(1000)
    expect((await resultPromise).runtimeStatus).toBe('unknown')
    expect(observed?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0)
  })

  it('does not start I/O after the shared budget is exhausted', async () => {
    vi.useFakeTimers(); let time = Date.now(); const p = ports()
    p.now.mockImplementation(() => time)
    p.configuration.mockImplementation(() => { time += 15000; return config })
    const result = await run(p)
    expect(p.database).not.toHaveBeenCalled(); expect(p.auth).not.toHaveBeenCalled()
    expect(result.checks).toContainEqual({ id: 'database.identity', status: 'unknown', code: 'timeout' })
    expect(vi.getTimerCount()).toBe(0)
  })
  it('consumes an adapter rejection arriving after its deadline', async () => {
    vi.useFakeTimers(); const p = ports(); let rejectLate!: (error: Error) => void
    const promise = run({ ...p, database: () => new Promise((_resolve, reject) => { rejectLate = reject }) })
    await vi.advanceTimersByTimeAsync(5000)
    expect((await promise).runtimeStatus).toBe('unknown')
    rejectLate(new Error('late-secret-sentinel'))
    await vi.advanceTimersByTimeAsync(0)
    expect(vi.getTimerCount()).toBe(0)
  })
  it('preserves unknown checks from valid port output', async () => {
    const p = ports()
    p.auth.mockResolvedValue(auth.map(check => ({ ...check, status: 'unknown', code: 'unavailable' })))
    const result = await run(p)
    expect(result.runtimeStatus).toBe('unknown')
    expect(result.checks).toContainEqual({ id: 'auth.jwks', status: 'unknown', code: 'unavailable' })
  })
})
