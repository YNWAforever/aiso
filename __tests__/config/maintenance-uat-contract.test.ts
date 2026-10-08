import { existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Page } from '@playwright/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

type Journey = (fixtures: { authenticatedPage: Page }) => Promise<void>
const harness = vi.hoisted(() => ({
  journeys: [] as Journey[],
  get: vi.fn(),
}))

// Execute the actual acceptance callback, replacing only browser/transport I/O.
// These synthetic IDs and responses are runner regressions, never Auth or C9 evidence.
vi.mock('@/tests/fixtures/auth', () => ({
  test: (_name: string, journey: Journey) => harness.journeys.push(journey),
  expect,
  authenticatedGet: harness.get,
}))

import '@/tests/e2e/authenticated/aiso-maintenance.spec'

const own = '11111111-1111-4111-8111-111111111111'
const foreign = '22222222-2222-4222-8222-222222222222'
const responses = {
  entity: { owned: { entity: null }, denied: 'CLIENT_NOT_FOUND' },
  sources: { owned: { sources: [] }, denied: 'SOURCES_NOT_FOUND' },
  observations: { owned: { items: [] }, denied: 'CLIENT_NOT_FOUND' },
  'work-items': { owned: { items: [] }, denied: 'CLIENT_NOT_FOUND' },
  prompts: { owned: { prompts: [] }, denied: 'Not found' },
}

expect.extend({
  toBeVisible: value => ({ pass: value?.heading === true, message: () => 'Expected the stub heading' }),
})
const page = {
  setViewportSize: async () => {},
  goto: async () => ({ status: () => 200 }),
  getByRole: () => ({ heading: true }),
  evaluate: async () => true,
} as unknown as Page

const reply = (status: number, body: unknown) => ({ status: () => status, json: async () => body })
function routedReply(endpoint: string) {
  const route = resolve(process.cwd(), 'app', endpoint.replace(/\/(?:[0-9a-f-]{36})(?=\/)/, '/[clientId]').slice(1), 'route.ts')
  if (!existsSync(route) || !/export\s+async\s+function\s+GET\b/.test(readFileSync(route, 'utf8'))) {
    return { status: () => 404, json: async () => { throw new SyntaxError('HTML route-not-found response') } }
  }
  const resource = endpoint.split('/').at(-1) as keyof typeof responses
  const contract = responses[resource]
  if (!contract) throw new Error(`Unexpected read route: ${endpoint}`)
  return endpoint.includes(own) ? reply(200, contract.owned) : reply(404, { error: contract.denied })
}
const run = () => harness.journeys[0]({ authenticatedPage: page })

beforeEach(() => {
  // Test-only isolation configuration; no browser session, environment approval or DB call.
  vi.stubEnv('AISO_UAT_ISOLATED', '1')
  vi.stubEnv('AISO_UAT_CLIENT_ID', own)
  vi.stubEnv('AISO_UAT_FOREIGN_CLIENT_ID', foreign)
  harness.get.mockReset().mockImplementation((_page: Page, endpoint: string) => routedReply(endpoint))
})
afterEach(() => vi.unstubAllEnvs())

describe('maintenance acceptance cannot mistake routing or dependency errors for tenancy proof', () => {
  it('registers both locales at all three acceptance widths', () => {
    expect(harness.journeys).toHaveLength(6)
  })

  it('reads all five existing owned routes before checking their foreign counterparts', async () => {
    await run()
    const paths = harness.get.mock.calls.map(([, endpoint]) => endpoint as string)
    expect(paths.filter(path => path.includes(own))).toHaveLength(5)
    expect(paths.filter(path => path.includes(foreign))).toHaveLength(5)
    for (const path of paths) await expect(routedReply(path).json()).resolves.toBeDefined()
  })

  it.each([401, 404, 503])('rejects an owned API answering %s instead of reading successfully', async status => {
    harness.get.mockImplementation((_page: Page, endpoint: string) =>
      endpoint.includes(own) ? reply(status, { error: 'unavailable' }) : routedReply(endpoint))
    await expect(run()).rejects.toThrow()
  })

  it('rejects a generic HTML 404 even when the owning route works', async () => {
    harness.get.mockImplementation((_page: Page, endpoint: string) => endpoint.includes(foreign)
      ? { status: () => 404, json: async () => { throw new SyntaxError('HTML 404') } }
      : routedReply(endpoint))
    await expect(run()).rejects.toThrow()
  })

  it('rejects a generic JSON 404 instead of the API ownership error', async () => {
    harness.get.mockImplementation((_page: Page, endpoint: string) => endpoint.includes(foreign)
      ? reply(404, { error: 'ROUTE_NOT_FOUND' }) : routedReply(endpoint))
    await expect(run()).rejects.toThrow()
  })

  it('rejects a denial that leaks foreign data alongside its error', async () => {
    harness.get.mockImplementation((_page: Page, endpoint: string) => endpoint.includes(foreign)
      ? reply(404, { error: 'CLIENT_NOT_FOUND', entity: { displayName: 'foreign' } }) : routedReply(endpoint))
    await expect(run()).rejects.toThrow()
  })

  it('rejects an owned 200 that contains no successful read payload', async () => {
    harness.get.mockImplementation((_page: Page, endpoint: string) => endpoint.includes(own)
      ? reply(200, { error: 'unavailable' }) : routedReply(endpoint))
    await expect(run()).rejects.toThrow()
  })
})
