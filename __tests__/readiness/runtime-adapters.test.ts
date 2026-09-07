import { describe, expect, it, vi } from 'vitest'
import type { neon } from '@neondatabase/serverless'
import { createRuntimePorts } from '@/lib/readiness/runtime-adapters'
import { hashPolicy, type RuntimePolicy } from '@/lib/readiness/runtime-contract'
import { runRuntimeProbe } from '@/lib/readiness/runtime'
import { createPublicUrlFetcher } from '@/lib/security/public-url'
import { renderRuntimeReport } from '@/lib/readiness/runtime-report'

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
  const publicFetcher = vi.fn(async (url: string | URL | Request) => Response.json(String(url).endsWith('/jwks') ? { keys: [{ kty: 'RSA' }] } : null))
  const ports = createRuntimePorts({ env: { ...env, ...overrides }, now: () => 1000, neonFactory, publicFetcher })
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
    expect(f.publicFetcher.mock.calls[0][0].toString()).toBe('https://issuer.example/neondb/auth/jwks')
    expect(JSON.stringify(f.publicFetcher.mock.calls[0])).not.toContain('protection')
    expect(JSON.stringify(f.publicFetcher.mock.calls)).not.toContain('sentinel')
  })
  it.each([{ keys: [] }, { keys: null }, null, 'bad'])('rejects invalid JWKS %j', async body => {
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
  f.publicFetcher.mockImplementation(async url => String(url).endsWith('/jwks') ? Response.json({ keys: [{ kty: 'RSA' }] }) : new Response(new ReadableStream({ cancel }), { status }))
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
