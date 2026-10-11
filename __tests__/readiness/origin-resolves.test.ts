import { describe, expect, it, vi } from 'vitest'
import { configurationCheckIds, type ConfigCheck } from '@/lib/readiness/config'
import { createRuntimePorts } from '@/lib/readiness/runtime-adapters'
import { hashPolicy, type ProbeRequest, type RuntimePolicy } from '@/lib/readiness/runtime-contract'
import { runRuntimeProbe } from '@/lib/readiness/runtime'
import type { LookupAll } from '@/lib/security/public-url'

// Production, until 2026-10-10: NEXT_PUBLIC_APP_URL was https://aeo.fimmick.com,
// which no longer resolves. Readiness checked only that it was https, so a dead
// origin passed, and every Pulse driver self-call failed with 502.

const origin = async (url: string | undefined, lookup: LookupAll, signal = new AbortController().signal) =>
  createRuntimePorts({ env: { NEXT_PUBLIC_APP_URL: url }, lookup }).origin(signal)
const dnsError = (code: string) => Object.assign(new Error(code), { code })

describe('origin.resolves adapter', () => {
  it('passes when the app host resolves to a public address', async () => {
    // A real public address (Vercel's anycast); documentation ranges such as
    // 203.0.113.0/24 are deliberately not public to isPublicAddress.
    const lookup = vi.fn<LookupAll>(async () => [{ address: '76.76.21.21', family: 4 }])
    expect(await origin('https://app.example.com', lookup)).toEqual([{ id: 'origin.resolves', status: 'pass', code: 'resolved' }])
    expect(lookup).toHaveBeenCalledWith('app.example.com', expect.any(AbortSignal))
  })

  it('fails on NXDOMAIN, the failure it exists for', async () => {
    const lookup = vi.fn<LookupAll>(async () => { throw dnsError('ENOTFOUND') })
    expect(await origin('https://aeo.fimmick.com', lookup)).toEqual([{ id: 'origin.resolves', status: 'fail', code: 'unresolved' }])
  })

  it('fails when the host has no records or only private addresses', async () => {
    expect(await origin('https://app.example.com', async () => [])).toEqual([{ id: 'origin.resolves', status: 'fail', code: 'unresolved' }])
    expect(await origin('https://app.example.com', async () => [{ address: '10.0.0.5', family: 4 }])).toEqual([{ id: 'origin.resolves', status: 'fail', code: 'unresolved' }])
  })

  it('is inconclusive, not failed, on any other DNS error', async () => {
    expect(await origin('https://app.example.com', async () => { throw dnsError('ESERVFAIL') })).toEqual([{ id: 'origin.resolves', status: 'unknown', code: 'probe_error' }])
  })

  it('reports a timeout when its signal aborts', async () => {
    const controller = new AbortController()
    const pending = origin('https://app.example.com', (_host, signal) => new Promise((_resolve, reject) => signal?.addEventListener('abort', () => reject(signal.reason))), controller.signal)
    controller.abort()
    expect(await pending).toEqual([{ id: 'origin.resolves', status: 'unknown', code: 'timeout' }])
  })

  it('does no lookup without a parseable app URL', async () => {
    const lookup = vi.fn<LookupAll>()
    expect(await origin(undefined, lookup)).toEqual([{ id: 'origin.resolves', status: 'unknown', code: 'dependency_failed' }])
    expect(lookup).not.toHaveBeenCalled()
  })
})

describe('origin.resolves in the probe', () => {
  const policy: RuntimePolicy = {
    version: 1, expectedDatabase: { project: 'project-test', branch: 'br-test', role: 'aeo_app', database: 'neondb' },
    capabilities: { claims: 'unknown', ai: 'unknown', billing: 'unknown', email: 'unknown', scheduler: 'unknown' },
    relations: [{ schema: 'public', relation: 'clients', privileges: ['SELECT'] }],
  }
  const expected = { teamId: 'team_test', projectId: 'prj_test', deploymentId: 'dpl_test', commitSha: 'b'.repeat(40), environment: 'preview' as const }
  const request: ProbeRequest = { schemaVersion: 1, nonce: 'a'.repeat(32), expected, policyHash: hashPolicy(policy), policy }
  const passing: ConfigCheck[] = configurationCheckIds.map(id => ({ id, status: 'pass', code: 'valid' }))
  const ports = (config: ConfigCheck[], originResult: unknown) => ({
    now: () => Date.now(), identity: () => expected, configuration: () => config,
    database: vi.fn(async () => ({ observedDatabase: policy.expectedDatabase, checks: [
      { id: 'database.identity', status: 'pass', code: 'matched' }, { id: 'database.read_only', status: 'pass', code: 'read_only' },
      { id: 'database.relation', policyIndex: 0, privilege: 'SELECT', status: 'pass', code: 'privilege_present' },
    ] })),
    auth: vi.fn(async () => [{ id: 'auth.jwks', status: 'pass', code: 'available' }, { id: 'auth.anonymous_session', status: 'pass', code: 'anonymous' }]),
    origin: vi.fn(async () => originResult),
  })

  it('fails the whole runtime report when the app host does not resolve', async () => {
    const p = ports(passing, [{ id: 'origin.resolves', status: 'fail', code: 'unresolved' }])
    const report = await runRuntimeProbe(request, p, new AbortController().signal)
    expect(report.checks).toContainEqual({ id: 'origin.resolves', status: 'fail', code: 'unresolved' })
    expect(report.runtimeStatus).toBe('fail')
  })

  it('does not probe an origin that failed configuration', async () => {
    const config = passing.map(c => c.id === 'config.NEXT_PUBLIC_APP_URL' ? { ...c, status: 'fail' as const, code: 'invalid' as const } : c)
    const p = ports(config, [])
    const report = await runRuntimeProbe(request, p, new AbortController().signal)
    expect(p.origin).not.toHaveBeenCalled()
    expect(report.checks).toContainEqual({ id: 'origin.resolves', status: 'unknown', code: 'dependency_failed' })
  })

  it('rejects an origin port that answers with another category', async () => {
    const p = ports(passing, [{ id: 'auth.jwks', status: 'pass', code: 'available' }])
    const report = await runRuntimeProbe(request, p, new AbortController().signal)
    expect(report.checks).toContainEqual({ id: 'origin.resolves', status: 'unknown', code: 'malformed_response' })
    expect(report.runtimeStatus).toBe('unknown')
  })
})
