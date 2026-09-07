import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { hashPolicy, type RuntimePolicy } from '@/lib/readiness/runtime-contract'
import { configurationCheckIds } from '@/lib/readiness/config'
const { factory, database, auth } = vi.hoisted(() => ({ factory: vi.fn(), database: vi.fn(), auth: vi.fn() }))
vi.mock('@/lib/readiness/runtime-adapters', () => ({ createRuntimePorts: factory }))
import * as route from '@/app/api/internal/readiness/route'
const secret = 'fixture-readiness-secret-0000000001'
const policy: RuntimePolicy = { version: 1, expectedDatabase: { project: 'p', branch: 'br', role: 'aeo_app', database: 'neondb' }, capabilities: { claims: 'unknown', ai: 'unknown', billing: 'unknown', email: 'unknown', scheduler: 'unknown' }, relations: [] }
const expected = { teamId: 'team', projectId: 'prj', deploymentId: 'dpl', commitSha: 'b'.repeat(40), environment: 'preview' }
const payload = { schemaVersion: 1, nonce: 'a'.repeat(32), expected, policyHash: hashPolicy(policy), policy }
function request(body: BodyInit = JSON.stringify(payload), authorization = 'Bearer ' + secret, signal?: AbortSignal) {
  return new Request('https://fixture.invalid/api/internal/readiness', { method: 'POST', body, headers: { authorization, 'content-length': '1' }, duplex: 'half', signal } as RequestInit)
}
beforeEach(() => {
  vi.stubEnv('READINESS_PROBE_SECRET', secret)
  factory.mockReset(); database.mockReset(); auth.mockReset()
  database.mockResolvedValue({ observedDatabase: policy.expectedDatabase, checks: [{ id: 'database.identity', status: 'pass', code: 'matched' }, { id: 'database.read_only', status: 'pass', code: 'read_only' }] })
  auth.mockResolvedValue([{ id: 'auth.jwks', status: 'pass', code: 'available' }, { id: 'auth.anonymous_session', status: 'pass', code: 'anonymous' }])
  factory.mockImplementation(() => ({ now: Date.now, identity: () => expected, configuration: () => configurationCheckIds.map(id => ({ id, status: 'pass', code: 'valid' })), database, auth }))
})
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers() })
describe('internal readiness route', () => {
  it.each([['', 503], ['short', 503], [secret, 401]] as const)('auth fails before body and adapters', async (configured, status) => {
    vi.stubEnv('READINESS_PROBE_SECRET', configured)
    const req = request('not json', 'Bearer wrong')
    const body = vi.spyOn(req, 'body', 'get')
    const response = await route.POST(req)
    expect(response.status).toBe(status); expect(response.headers.get('cache-control')).toBe('no-store')
    expect(body).not.toHaveBeenCalled(); expect(factory).not.toHaveBeenCalled()
  })
  it.each(['{', '{}', 'null', JSON.stringify({ ...payload, surprise: true })])('rejects invalid payload before adapters', async body => {
    expect((await route.POST(request(body))).status).toBe(400); expect(factory).not.toHaveBeenCalled()
  })
  it('rejects chunked oversized body and cancels', async () => {
    const cancel = vi.fn()
    const response = await route.POST(request(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(16385)) }, cancel })))
    expect(response.status).toBe(413); expect(cancel).toHaveBeenCalledOnce(); expect(factory).not.toHaveBeenCalled()
  })
  it.each(['GET', 'HEAD', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const)('%s has no probes and no-store', async method => {
    const response = await route[method]()
    expect(response.status).toBe(405); expect(response.headers.get('cache-control')).toBe('no-store'); expect(factory).not.toHaveBeenCalled()
  })
  it('returns advisory evidence and only allowlisted env without bearer', async () => {
    vi.stubEnv('UNRELATED_SECRET', 'sentinel')
    vi.stubEnv('VERCEL_AUTOMATION_BYPASS_SECRET', 'candidate-only')
    const response = await route.POST(request())
    expect(response.status).toBe(200); expect(response.headers.get('cache-control')).toBe('no-store')
    expect(await response.json()).toMatchObject({ enforced: false, productionReady: false, runtimeStatus: 'pass' })
    expect(factory.mock.calls[0][0].env).not.toHaveProperty('READINESS_PROBE_SECRET')
    expect(factory.mock.calls[0][0].env).not.toHaveProperty('UNRELATED_SECRET')
    expect(factory.mock.calls[0][0].env.VERCEL_AUTOMATION_BYPASS_SECRET).toBe('candidate-only')
  })
  it('returns completed unknown evidence with 200', async () => {
    database.mockRejectedValue(new Error('private-sentinel'))
    const response = await route.POST(request())
    expect(response.status).toBe(200); expect(await response.text()).not.toContain('private-sentinel')
  })
  it('contains inability to construct ports', async () => {
    factory.mockImplementation(() => { throw new Error('private-sentinel') })
    const response = await route.POST(request())
    expect(response.status).toBe(503); expect(await response.text()).not.toContain('private-sentinel')
  })
  it('cancels a slow body at the total deadline', async () => {
    vi.useFakeTimers()
    const cancel = vi.fn(); const body = new ReadableStream<Uint8Array>({ cancel })
    const result = route.POST(request(body))
    await vi.advanceTimersByTimeAsync(15000)
    expect((await result).status).toBe(503); expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false); expect(factory).not.toHaveBeenCalled()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('passes only the remaining budget after slow body to probes', async () => {
    vi.useFakeTimers(); let stream!: ReadableStreamDefaultController<Uint8Array>
    const body = new ReadableStream<Uint8Array>({ start(c) { stream = c } })
    const signals: AbortSignal[] = []
    database.mockImplementation((_: unknown, signal: AbortSignal) => new Promise((_resolve, reject) => { signals.push(signal); signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }) }))
    const result = route.POST(request(body))
    await vi.advanceTimersByTimeAsync(14000)
    stream.enqueue(new TextEncoder().encode(JSON.stringify(payload))); stream.close()
    await vi.advanceTimersByTimeAsync(0)
    expect(database).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(1000)
    expect((await result).status).toBe(200); expect(signals[0].aborted).toBe(true); expect(vi.getTimerCount()).toBe(0)
  })
  it('reads no adapter environment until both authorization and payload succeed', async () => {
    const original = process.env
    const accessed: string[] = []
    process.env = new Proxy(original, { get(target, key: string) { if (['DATABASE_URL', 'VERCEL_AUTOMATION_BYPASS_SECRET', 'NEON_AUTH_COOKIE_SECRET'].includes(key)) accessed.push(key); return target[key] } })
    try {
      expect((await route.POST(request('{}', 'Bearer wrong'))).status).toBe(401)
      expect((await route.POST(request('{}'))).status).toBe(400)
      expect(accessed).toEqual([])
      expect(factory).not.toHaveBeenCalled()
    } finally { process.env = original }
  })
  it('cancels body I/O when the caller disconnects', async () => {
    const controller = new AbortController(); const cancel = vi.fn()
    const body = new ReadableStream<Uint8Array>({ cancel })
    const result = route.POST(request(body, 'Bearer ' + secret, controller.signal))
    controller.abort()
    expect((await result).status).toBe(503)
    expect(cancel).toHaveBeenCalledOnce(); expect(body.locked).toBe(false)
    expect(factory).not.toHaveBeenCalled()
  })
  it('imports without reading readiness configuration or constructing clients', async () => {
    vi.resetModules(); factory.mockClear()
    const original = process.env
    const accessed: string[] = []
    process.env = new Proxy(original, { get(target, key: string) { if (key === 'READINESS_PROBE_SECRET' || key === 'DATABASE_URL') accessed.push(key); return target[key] } })
    try { await import('@/app/api/internal/readiness/route'); expect(accessed).toEqual([]); expect(factory).not.toHaveBeenCalled() }
    finally { process.env = original }
  })
})
