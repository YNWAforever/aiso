import { afterEach, expect, it, vi } from 'vitest'
import { createRuntimePorts } from '@/lib/readiness/runtime-adapters'
import type { RuntimePolicy } from '@/lib/readiness/runtime-contract'

const dns = vi.hoisted(() => ({ cancel: vi.fn(), lookup: vi.fn(() => new Promise(() => {})), resolve4: vi.fn(() => new Promise<string[]>(() => {})), resolve6: vi.fn(() => new Promise<string[]>(() => {})) }))
vi.mock('node:dns/promises', () => ({ lookup: dns.lookup, Resolver: class { resolve4 = dns.resolve4; resolve6 = dns.resolve6; cancel = dns.cancel } }))
afterEach(() => vi.clearAllMocks())

it('physically cancels the readiness DNS resolver on parent abort without starting a second lookup', async () => {
  const ports = createRuntimePorts({ env: { VERCEL: '1', VERCEL_PROJECT_ID: 'prj_test', VERCEL_DEPLOYMENT_ID: 'dpl_test', VERCEL_GIT_COMMIT_SHA: 'b'.repeat(40), VERCEL_ENV: 'preview', VERCEL_URL: 'candidate-test.vercel.app', READINESS_EXPECTED_TEAM_ID: 'team_test', NEON_AUTH_BASE_URL: 'https://issuer.example/neondb/auth' } })
  expect(dns.lookup).not.toHaveBeenCalled()
  expect(dns.resolve4).not.toHaveBeenCalled()
  const controller = new AbortController()
  const pending = ports.auth({} as RuntimePolicy, controller.signal)
  controller.abort()
  expect(await pending).toEqual([{ id: 'auth.jwks', status: 'unknown', code: 'timeout' }, { id: 'auth.anonymous_session', status: 'unknown', code: 'timeout' }])
  expect(dns.cancel).toHaveBeenCalled()
  expect(dns.resolve4).toHaveBeenCalledTimes(1)
  expect(dns.resolve6).toHaveBeenCalledTimes(1)
  expect(dns.lookup).not.toHaveBeenCalled()
})

it('cancels DNS on the real readiness five-second auth deadline', async () => {
  const ports = createRuntimePorts({ env: { VERCEL: '1', VERCEL_PROJECT_ID: 'prj_test', VERCEL_DEPLOYMENT_ID: 'dpl_test', VERCEL_GIT_COMMIT_SHA: 'b'.repeat(40), VERCEL_ENV: 'preview', VERCEL_URL: 'candidate-test.vercel.app', READINESS_EXPECTED_TEAM_ID: 'team_test', NEON_AUTH_BASE_URL: 'https://issuer.example/neondb/auth' } })
  const checks = await ports.auth({} as RuntimePolicy, new AbortController().signal)
  expect(checks).toEqual([{ id: 'auth.jwks', status: 'unknown', code: 'timeout' }, { id: 'auth.anonymous_session', status: 'unknown', code: 'timeout' }])
  expect(dns.cancel).toHaveBeenCalledTimes(1)
  expect(dns.resolve4).toHaveBeenCalledTimes(1)
  expect(dns.resolve6).toHaveBeenCalledTimes(1)
  expect(dns.lookup).not.toHaveBeenCalled()
}, 10000)
