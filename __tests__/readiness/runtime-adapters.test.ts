import { AsyncLocalStorage } from 'node:async_hooks'
import { generateKeyPairSync } from 'node:crypto'
import { validateReport } from '../../scripts/readiness/candidate-contract.mjs'
import { runCandidateCheck } from '../../scripts/readiness/check-candidate.mjs'
import wireFixture from '../fixtures/runtime-candidate.json'
import { describe, expect, it, vi } from 'vitest'
import type { neon } from '@neondatabase/serverless'
import { createRuntimePorts } from '@/lib/readiness/runtime-adapters'
import { hashPolicy, type RuntimePolicy } from '@/lib/readiness/runtime-contract'
import { runRuntimeProbe } from '@/lib/readiness/runtime'
import { createPublicUrlFetcher } from '@/lib/security/public-url'
import { renderRuntimeReport } from '@/lib/readiness/runtime-report'

const publicJwk = generateKeyPairSync('rsa', { modulusLength: 2048 }).publicKey.export({ format: 'jwk' })
const policy: RuntimePolicy = { version: 1, expectedDatabase: { project: 'project-test', branch: 'br-test', role: 'aeo_app', database: 'neondb' }, capabilities: { claims: 'unknown', ai: 'unknown', billing: 'unknown', email: 'unknown', scheduler: 'unknown' }, relations: [{ schema: 'public', relation: 'clients', privileges: ['SELECT', 'INSERT'] }] }
const expected = { teamId: 'team_test', projectId: 'prj_test', deploymentId: 'dpl_test', commitSha: 'b'.repeat(40), environment: 'preview' as const }
const env = { VERCEL: '1', VERCEL_PROJECT_ID: expected.projectId, VERCEL_DEPLOYMENT_ID: expected.deploymentId, VERCEL_GIT_COMMIT_SHA: expected.commitSha, VERCEL_ENV: 'preview', VERCEL_URL: 'candidate-test.vercel.app', READINESS_EXPECTED_TEAM_ID: expected.teamId, DATABASE_URL: 'postgresql://aeo_app:fixture@db.example/neondb', EXPECTED_NEON_PROJECT_ID: 'project-test', EXPECTED_NEON_BRANCH_ID: 'br-test', EXPECTED_DB_ROLE: 'aeo_app', EXPECTED_DB_NAME: 'neondb', NEON_AUTH_BASE_URL: 'https://issuer.example/neondb/auth', NEON_AUTH_COOKIE_SECRET: 'x'.repeat(32), PUBLIC_SCAN_RATE_LIMIT_SECRET: 'y'.repeat(32), NEXT_PUBLIC_APP_URL: 'https://candidate-test.vercel.app' }
const identity = { project_id: 'project-test', branch_id: 'br-test', role: 'aeo_app', database: 'neondb', read_only: 'on', rolsuper: false, rolbypassrls: true, rolcreatedb: false, rolcreaterole: false, rolreplication: false, owner: false, elevated_membership: false }
function fixture(overrides: Record<string, string | undefined> = {}, rows = identity) {
  const queries: { text: string; values: unknown[] }[][] = []
  const transaction = vi.fn(async (callback: (tag: unknown) => unknown[], options: unknown): Promise<Record<string, unknown>[][]> => {
    void options
    const batch: { text: string; values: unknown[] }[] = []
    callback((strings: TemplateStringsArray, ...values: unknown[]) => { batch.push({ text: strings.join('?'), values }); return {} })
    queries.push(batch)
    return batch.map(q => q.text.includes('jsonb_to_recordset') ? policy.relations.flatMap((r, policyIndex) => r.privileges.map(privilege => ({ ...rows, policy_index: policyIndex, privilege, present: true, permitted: true }))) : q.text.includes('current_setting') ? [rows] : [])
  })
  const neonFactory = vi.fn(() => ({ transaction })) as unknown as typeof neon
  const publicFetcher = vi.fn(async (url: string | URL | Request) => Response.json(String(url).endsWith('/.well-known/jwks.json') ? { keys: [publicJwk] } : null))
  const ports = createRuntimePorts({ env: { ...env, ...overrides }, now: () => 1000, neonFactory, publicFetcher, getOidcToken: () => 'synthetic-request-oidc' })
  return { ports, queries, transaction, neonFactory, publicFetcher }
}
const request = { schemaVersion: 1 as const, nonce: 'a'.repeat(32), expected, policy, policyHash: hashPolicy(policy) }
const signal = () => new AbortController().signal

describe('runtime adapters', () => {
  it('keeps configured team separate and permits verified runtime probes', async () => {
    const f = fixture(); expect(f.neonFactory).not.toHaveBeenCalled()
    expect(f.ports.identity()).toEqual({ ...expected, teamId: null })
    const report = await runRuntimeProbe(request, f.ports, signal())
    expect(report.observed.teamId).toBeNull(); expect(report.configuredTeamId).toBe(expected.teamId)
    expect(renderRuntimeReport(report, policy)).toContain('Configured team expectation (runner control-plane verification required)')
    expect(report.checks.find(c => c.id === 'candidate.identity')?.status).toBe('pass')
    expect(f.transaction).toHaveBeenCalledTimes(2); expect(f.publicFetcher).toHaveBeenCalledTimes(2)
  })
  it.each([undefined, 'wrong', 'bad team'])('suppresses I/O for configured team %s', async team => {
    const f = fixture({ READINESS_EXPECTED_TEAM_ID: team }); await runRuntimeProbe(request, f.ports, signal())
    expect(f.neonFactory).not.toHaveBeenCalled(); expect(f.publicFetcher).not.toHaveBeenCalled()
  })
  it('uses read-only transactions, local timeout, cancellation and parameterized metadata only', async () => {
    const f = fixture(); const abort = signal(); await f.ports.database(policy, abort)
    for (const call of f.transaction.mock.calls) expect(call[1]).toEqual({ readOnly: true, fetchOptions: { signal: expect.any(AbortSignal) } })
    for (const batch of f.queries) expect(batch[0].text).toContain("set local statement_timeout = '5s'")
    const metadata = f.queries[1].find(q => q.text.includes('jsonb_to_recordset'))!
    expect(metadata.text).toContain('case when'); expect(metadata.text).toContain('has_table_privilege'); expect(metadata.text).not.toContain('from public.clients')
    expect(JSON.stringify(metadata.values)).toContain('clients')
  })
  it.each([{ project_id: 'wrong' }, { role: 'neondb_owner' }, { rolsuper: true }, { rolbypassrls: false }, { owner: true }, { rolcreatedb: true }, { elevated_membership: true }])('blocks metadata for invalid binding or role %j', async change => {
    const f = fixture({}, { ...identity, ...change }); const result = await f.ports.database(policy, signal())
    expect(f.transaction).toHaveBeenCalledTimes(1); expect(JSON.stringify(result)).toContain('fail')
  })
  it('honors forbidden target even when it matches the policy', async () => {
    const f = fixture({ FORBIDDEN_NEON_PROJECT_IDS: identity.project_id }); await f.ports.database(policy, signal())
    expect(f.queries.some(b => b.some(q => q.text.includes('has_table_privilege')))).toBe(false)
  })
  it('does not forward readiness or protection credentials to issuer', async () => {
    const f = fixture({ READINESS_PROBE_SECRET: 'sentinel', VERCEL_AUTOMATION_BYPASS_SECRET: 'protection' }); await f.ports.auth(policy, signal())
    expect(f.publicFetcher.mock.calls[0][0].toString()).toBe('https://issuer.example/neondb/auth/.well-known/jwks.json')
    expect(JSON.stringify(f.publicFetcher.mock.calls[0])).not.toContain('protection')
    expect(JSON.stringify(f.publicFetcher.mock.calls)).not.toContain('sentinel')
  })
  it.each([{ keys: [] }, { keys: null }, { keys: [{}] }, { keys: [{ kty: 'RSA' }] }, { keys: [{ ...publicJwk, n: '' }] }, { keys: [{ ...publicJwk, e: '!' }] }, { keys: [{ ...publicJwk, d: 'private' }] }, { keys: [{ kty: 'oct', k: 'c2VjcmV0' }] }, null, 'bad'])('rejects invalid JWKS %j', async body => {
    const f = fixture(); f.publicFetcher.mockImplementation(async () => Response.json(body))
    expect(JSON.stringify(await f.ports.auth(policy, signal()))).toContain('malformed_response')
  })
  it('redacts SDK exceptions', async () => {
    const f = fixture(); f.transaction.mockRejectedValue(new Error('postgresql://secret-sentinel'))
    const result = await f.ports.database(policy, signal()); expect(JSON.stringify(result)).toContain('connection_failed'); expect(JSON.stringify(result)).not.toContain('sentinel')
  })
})

it('gates second-transaction drift before accepting metadata results', async () => {
  const f = fixture(); const original = f.transaction.getMockImplementation()!
  f.transaction.mockImplementation(async (...args) => { const result = await original(...args); if (f.queries.length === 2) result[1] = [{ ...identity, branch_id: 'wrong' }]; return result })
  const result = await f.ports.database(policy, signal())
  expect(JSON.stringify(result)).toContain('identity_mismatch'); expect(JSON.stringify(result)).not.toContain('privilege_present')
})
it('classifies absent relation and each independent privilege', async () => {
  const f = fixture(); const original = f.transaction.getMockImplementation()!
  f.transaction.mockImplementation(async (...args) => { const result = await original(...args); if (f.queries.length === 2) result[2][1].permitted = false; return result })
  const result = await f.ports.database(policy, signal())
  expect(JSON.stringify(result)).toContain('privilege_present'); expect(JSON.stringify(result)).toContain('privilege_missing')
  f.transaction.mockImplementation(async (...args) => { const result = await original(...args); if (result.length === 3) result[2].forEach(row => { row.present = false; row.permitted = null }); return result })
  expect(JSON.stringify(await f.ports.database(policy, signal()))).toContain('relation_missing')
  expect(f.queries[1][2].text).toContain('case when binding.ok and c.oid is not null then has_table_privilege')
})
it('cancels a pending auth response body on caller abort', async () => {
  const f = fixture(); const controller = new AbortController(); const cancel = vi.fn()
  f.publicFetcher.mockImplementation(async () => new Response(new ReadableStream({ cancel })))
  const pending = f.ports.auth(policy, controller.signal)
  await vi.waitFor(() => expect(f.publicFetcher).toHaveBeenCalledOnce())
  controller.abort(); const result = await pending
  expect(cancel).toHaveBeenCalledOnce(); expect(JSON.stringify(result)).toContain('timeout')
})
it('propagates cancellation to the SDK and maps statement timeout safely', async () => {
  const f = fixture(); const controller = new AbortController()
  f.transaction.mockImplementation(async (_callback, options) => new Promise((_resolve, reject) => {
    (options as { fetchOptions: { signal: AbortSignal } }).fetchOptions.signal.addEventListener('abort', () => reject(new Error('secret-sentinel')), { once: true })
  }))
  const pending = f.ports.database(policy, controller.signal); controller.abort()
  expect(JSON.stringify(await pending)).toContain('timeout')
  f.transaction.mockRejectedValue(Object.assign(new Error('secret-sentinel'), { code: '57014' }))
  expect(JSON.stringify(await f.ports.database(policy, signal()))).toContain('timeout')
})
it.each([401, 302])('rejects candidate HTTP %s and cancels the response', async status => {
  const f = fixture(); const cancel = vi.fn()
  f.publicFetcher.mockImplementation(async url => String(url).endsWith('/.well-known/jwks.json') ? Response.json({ keys: [publicJwk] }) : new Response(new ReadableStream({ cancel }), { status }))
  const result = await f.ports.auth(policy, signal()); expect(JSON.stringify(result)).toContain('unavailable'); expect(cancel).toHaveBeenCalledOnce()
})
it('rejects anonymous session data and oversized bodies', async () => {
  const f = fixture(); f.publicFetcher.mockImplementation(async () => Response.json({ user: { id: 'sentinel' } }))
  expect(JSON.stringify(await f.ports.auth(policy, signal()))).toContain('session_present')
  const cancel = vi.fn(); f.publicFetcher.mockImplementation(async () => new Response(new ReadableStream({ start(c) { c.enqueue(new Uint8Array(65537)) }, cancel })))
  expect(JSON.stringify(await f.ports.auth(policy, signal()))).toContain('malformed_response'); expect(cancel).toHaveBeenCalledTimes(2)
})
it('treats missing database identity as unknown unless another binding field mismatches', async () => {
  const f = fixture({}, { ...identity, project_id: null } as unknown as typeof identity)
  expect(JSON.stringify(await f.ports.database(policy, signal()))).toContain('identity_unavailable')
  const mismatch = fixture({}, { ...identity, project_id: null, branch_id: 'wrong' } as unknown as typeof identity)
  expect(JSON.stringify(await mismatch.ports.database(policy, signal()))).toContain('identity_mismatch')
})
it('rejects private destinations before injected transport can run', async () => {
  const transport = vi.fn(); const lookup = vi.fn(async () => [{ address: '127.0.0.1', family: 4 as const }])
  const publicFetcher = createPublicUrlFetcher({ lookup, fetchImpl: transport, allowedProtocols: ['https:'], maxRedirects: 0, maxResponseBytes: 65536, timeoutMs: 5000 })
  const f = fixture(); const ports = createRuntimePorts({ env, now: () => 1000, neonFactory: f.neonFactory, publicFetcher })
  const result = await ports.auth(policy, signal()); expect(JSON.stringify(result)).not.toContain('pass'); expect(transport).not.toHaveBeenCalled()
})
it.each(['VERCEL_PROJECT_ID', 'VERCEL_DEPLOYMENT_ID', 'VERCEL_GIT_COMMIT_SHA', 'VERCEL_ENV', 'VERCEL_URL'])('suppresses I/O when runtime field %s is unavailable', async key => {
  const f = fixture({ [key]: undefined }); await runRuntimeProbe(request, f.ports, signal())
  expect(f.neonFactory).not.toHaveBeenCalled(); expect(f.publicFetcher).not.toHaveBeenCalled()
})


it('labels each Markdown policy index and privilege distinctly', async () => {
  const f = fixture(); const report = await runRuntimeProbe(request, f.ports, signal())
  const markdown = renderRuntimeReport(report, policy)
  expect(markdown).toContain('database.relation[0:SELECT]: pass (privilege_present)')
  expect(markdown).toContain('database.relation[0:INSERT]: pass (privilege_present)')
})
it.each(['connection', 'mismatch', 'read-only', 'timeout', 'auth-early'] as const)('preserves real adapter %s failures through runner artifacts', async failure => {
  const f = fixture({}, failure === 'mismatch' ? { ...identity, branch_id: 'wrong' } : failure === 'read-only' ? { ...identity, read_only: 'off' } : identity)
  if (failure === 'connection') f.transaction.mockRejectedValue(new Error('private-sentinel'))
  if (failure === 'timeout') f.transaction.mockRejectedValue(Object.assign(new Error('private-sentinel'), { code: '57014' }))
  if (failure === 'auth-early') f.publicFetcher.mockRejectedValue(new Error('private-sentinel'))
  const report = await runRuntimeProbe(request, f.ports, signal())
  expect(validateReport(report, { expected, nonce: request.nonce, policy, now: 1000 })).toEqual(report)
  expect(report.checks).toContainEqual(expect.objectContaining({ id: failure === 'auth-early' ? 'auth.jwks' : failure === 'read-only' ? 'database.read_only' : 'database.identity', code: failure === 'connection' ? 'connection_failed' : failure === 'timeout' ? 'timeout' : failure === 'mismatch' ? 'identity_mismatch' : failure === 'read-only' ? 'read_only_unverified' : 'malformed_response' }))
  if (failure !== 'auth-early') for (const privilege of policy.relations[0].privileges) expect(report.checks).toContainEqual({ id: 'database.relation', policyIndex: 0, privilege, status: 'unknown', code: 'dependency_failed' })
  const writes = vi.fn(async () => {})
  const result = await runCandidateCheck({ expected, policy, outputDir: 'synthetic-output', vercelToken: 'vercel-sentinel', readinessSecret: 'readiness-sentinel' }, { now: () => 1000, nonce: () => request.nonce, fetch: async (_url: string, init: RequestInit) => Response.json(init.method === 'POST' ? report : wireFixture.metadata), mkdir: async () => {}, writeFile: writes })
  expect(result.exitCode).toBe(1); expect(writes).toHaveBeenCalledTimes(2)
  expect(JSON.stringify(writes.mock.calls)).not.toContain('sentinel')
})

it('normalizes both real adapter categories after candidate identity prevents I/O', async () => {
  const f = fixture({ READINESS_EXPECTED_TEAM_ID: undefined })
  const report = await runRuntimeProbe(request, f.ports, signal())
  expect(report.checks).toContainEqual({ id: 'auth.anonymous_session', status: 'unknown', code: 'dependency_failed' })
  expect(report.checks).toContainEqual({ id: 'database.read_only', status: 'unknown', code: 'dependency_failed' })
  expect(f.publicFetcher).not.toHaveBeenCalled(); expect(f.neonFactory).not.toHaveBeenCalled()
})
it('preserves timeout evidence from a cancelled real adapter through strict report validation', async () => {
  vi.useFakeTimers()
  try {
    const f = fixture()
    f.transaction.mockImplementation(async (_callback, options) => new Promise((_resolve, reject) => {
      (options as { fetchOptions: { signal: AbortSignal } }).fetchOptions.signal.addEventListener('abort', () => reject(new Error('private-sentinel')), { once: true })
    }))
    const pending = runRuntimeProbe(request, f.ports, signal())
    await vi.advanceTimersByTimeAsync(5000)
    const report = await pending
    expect(report.checks).toContainEqual({ id: 'database.identity', status: 'unknown', code: 'timeout' })
    expect(validateReport(report, { expected, nonce: request.nonce, policy, now: 1000 })).toEqual(report)
  } finally { vi.useRealTimers() }
})
it('accepts genuine synthetic public signing key material', async () => {
  const f = fixture()
  expect(await f.ports.auth(policy, signal())).toContainEqual({ id: 'auth.jwks', status: 'pass', code: 'available' })
})

it('authenticates a protected self-call with request-scoped OIDC while keeping the session anonymous', async () => {
  const f = fixture()
  const getOidcToken = vi.fn(() => 'short-lived-synthetic-oidc')
  const requests: { url: string; init: RequestInit | undefined }[] = []
  const publicFetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ url: String(url), init })
    if (String(url).endsWith('/.well-known/jwks.json')) return Response.json({ keys: [publicJwk] })
    return new Headers(init?.headers).get('x-vercel-trusted-oidc-idp-token') === 'short-lived-synthetic-oidc'
      ? Response.json(null) : new Response(null, { status: 302 })
  })
  const ports = createRuntimePorts({ env, neonFactory: f.neonFactory, publicFetcher, getOidcToken })
  expect(await ports.auth(policy, signal())).toContainEqual({ id: 'auth.anonymous_session', status: 'pass', code: 'anonymous' })
  expect(getOidcToken).toHaveBeenCalledOnce()
  expect(requests).toHaveLength(2)
  expect(new Headers(requests[0].init?.headers).get('x-vercel-trusted-oidc-idp-token')).toBeNull()
  expect(requests[1].url).toBe('https://candidate-test.vercel.app/api/auth/get-session')
  expect(requests[1].init).toEqual(expect.objectContaining({ method: 'GET', credentials: 'omit', redirect: 'manual' }))
  for (const { init } of requests) {
    expect(new Headers(init?.headers).get('cookie')).toBeNull()
    expect(new Headers(init?.headers).get('authorization')).toBeNull()
  }
})

it('reads the official SDK request context for each self-call without caching or env-token precedence', async () => {
  const contextKey = Symbol.for('@vercel/request-context')
  const globals = globalThis as unknown as Record<symbol, unknown>
  const previous = globals[contextKey]
  const storage = new AsyncLocalStorage<{ headers: Record<string, string> }>()
  globals[contextKey] = { get: () => storage.getStore() }
  const previousToken = process.env.VERCEL_OIDC_TOKEN
  process.env.VERCEL_OIDC_TOKEN = 'stale-env-sentinel'
  try {
    const f = fixture()
    const calls: { url: string; headers: Headers }[] = []
    const publicFetcher = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), headers: new Headers(init?.headers) })
      return Response.json(String(url).endsWith('/.well-known/jwks.json') ? { keys: [publicJwk] } : null)
    })
    const ports = createRuntimePorts({ env, publicFetcher })
    for (const token of ['first-request-token', 'second-request-token']) {
      await storage.run({ headers: { 'x-vercel-oidc-token': token } }, async () => {
        expect(await ports.auth(policy, signal())).toContainEqual({ id: 'auth.anonymous_session', status: 'pass', code: 'anonymous' })
      })
    }
    expect(calls.map(c => c.headers.get('x-vercel-trusted-oidc-idp-token'))).toEqual([null, 'first-request-token', null, 'second-request-token'])
    expect(f.publicFetcher).not.toHaveBeenCalled()
  } finally {
    if (previous === undefined) delete globals[contextKey]; else globals[contextKey] = previous
    if (previousToken === undefined) delete process.env.VERCEL_OIDC_TOKEN; else process.env.VERCEL_OIDC_TOKEN = previousToken
  }
})

it.each(['', 'invalid\r\nsecret-sentinel', 'x'.repeat(16385)])('blocks unusable self-access tokens without fallback, leakage or retry', async token => {
  const f = fixture()
  const getOidcToken = vi.fn(() => token)
  const ports = createRuntimePorts({ env, publicFetcher: f.publicFetcher, getOidcToken })
  const checks = await ports.auth(policy, signal())
  expect(checks).toContainEqual({ id: 'auth.anonymous_session', status: 'unknown', code: 'unavailable' })
  expect(f.publicFetcher).toHaveBeenCalledOnce()
  expect(getOidcToken).toHaveBeenCalledOnce()
  expect(JSON.stringify(checks)).not.toContain('sentinel')
})

it('redacts missing OIDC context errors and keeps the explicit legacy bypass scoped to self-access', async () => {
  const f = fixture()
  const getOidcToken = vi.fn(() => { throw new Error('secret-context-sentinel') })
  const ports = createRuntimePorts({ env, publicFetcher: f.publicFetcher, getOidcToken })
  const checks = await ports.auth(policy, signal())
  expect(checks).toContainEqual({ id: 'auth.anonymous_session', status: 'unknown', code: 'unavailable' })
  expect(JSON.stringify(checks)).not.toContain('sentinel')
  expect(f.publicFetcher).toHaveBeenCalledOnce()
  const transport = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const headers = new Headers(init?.headers)
    expect(headers.get('x-vercel-trusted-oidc-idp-token')).toBeNull()
    if (String(url).endsWith('/.well-known/jwks.json')) {
      expect(headers.get('x-vercel-protection-bypass')).toBeNull()
      return Response.json({ keys: [publicJwk] })
    }
    expect(headers.get('x-vercel-protection-bypass')).toBe('explicit-legacy-bypass')
    return Response.json(null)
  })
  const legacy = createRuntimePorts({ env: { ...env, VERCEL_AUTOMATION_BYPASS_SECRET: 'explicit-legacy-bypass' }, publicFetcher: transport, getOidcToken })
  expect(await legacy.auth(policy, signal())).toContainEqual({ id: 'auth.anonymous_session', status: 'pass', code: 'anonymous' })
  expect(transport).toHaveBeenCalledTimes(2)
})

it('does not obtain a token or send a self-call for an invalid candidate or cancelled request', async () => {
  const f = fixture(), getOidcToken = vi.fn(() => 'synthetic-oidc')
  const invalid = createRuntimePorts({ env: { ...env, VERCEL_URL: 'foreign.example' }, publicFetcher: f.publicFetcher, getOidcToken })
  await invalid.auth(policy, signal())
  const controller = new AbortController(); controller.abort()
  await createRuntimePorts({ env, publicFetcher: f.publicFetcher, getOidcToken }).auth(policy, controller.signal)
  expect(getOidcToken).not.toHaveBeenCalled()
  expect(f.publicFetcher).not.toHaveBeenCalled()
})

it('never follows a protected self-call redirect or retries the token-bearing request', async () => {
  const transport = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    if (String(url).endsWith('/.well-known/jwks.json')) return Response.json({ keys: [publicJwk] })
    expect(new Headers(init?.headers).get('x-vercel-trusted-oidc-idp-token')).toBe('synthetic-oidc')
    return new Response(null, { status: 302, headers: { location: 'https://foreign.example/steal' } })
  })
  const fetcher = createPublicUrlFetcher({ lookup: async () => [{ address: '8.8.8.8', family: 4 as const }], fetchImpl: transport, allowedProtocols: ['https:'], maxRedirects: 0, maxResponseBytes: 65536, timeoutMs: 5000 })
  const getOidcToken = vi.fn(() => 'synthetic-oidc')
  const ports = createRuntimePorts({ env, publicFetcher: fetcher, getOidcToken })
  expect(await ports.auth(policy, signal())).toContainEqual({ id: 'auth.anonymous_session', status: 'fail', code: 'malformed_response' })
  expect(getOidcToken).toHaveBeenCalledOnce()
  expect(transport).toHaveBeenCalledTimes(2)
  expect(transport.mock.calls.every(([url]) => String(url) !== 'https://foreign.example/steal')).toBe(true)
})

it('refuses a process-level OIDC token when the current request context is missing', async () => {
  const contextKey = Symbol.for('@vercel/request-context'), globals = globalThis as unknown as Record<symbol, unknown>
  const previousContext = globals[contextKey], previousToken = process.env.VERCEL_OIDC_TOKEN
  delete globals[contextKey]; process.env.VERCEL_OIDC_TOKEN = 'process-level-token-sentinel'
  try {
    const f = fixture(), ports = createRuntimePorts({ env, publicFetcher: f.publicFetcher })
    expect(await ports.auth(policy, signal())).toContainEqual({ id: 'auth.anonymous_session', status: 'unknown', code: 'unavailable' })
    expect(f.publicFetcher).toHaveBeenCalledOnce()
  } finally {
    if (previousContext === undefined) delete globals[contextKey]; else globals[contextKey] = previousContext
    if (previousToken === undefined) delete process.env.VERCEL_OIDC_TOKEN; else process.env.VERCEL_OIDC_TOKEN = previousToken
  }
})
