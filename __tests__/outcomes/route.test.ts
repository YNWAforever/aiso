import { readFileSync } from 'node:fs'
import { beforeEach, expect, test, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock('@/lib/outcomes/service', () => ({ getOutcomes: mocks.get }))
import { GET } from '@/app/api/clients/[clientId]/work-items/[workItemId]/versions/[versionId]/outcomes/route'

const params = {
  clientId: '123e4567-e89b-42d3-a456-426614174006',
  workItemId: '123e4567-e89b-42d3-a456-426614174007',
  versionId: '123e4567-e89b-42d3-a456-426614174008',
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.get.mockResolvedValue(Response.json({ ok: true }, { headers: { 'Cache-Control': 'private, no-store' } }))
})

test('awaits promised params and delegates the original request and exact scope', async () => {
  let resolve!: (value: typeof params) => void
  const promised = new Promise<typeof params>(done => { resolve = done })
  const request = new Request('https://example.test/outcomes')
  const pending = GET(request, { params: promised })
  expect(mocks.get).not.toHaveBeenCalled()
  resolve(params)
  const response = await pending
  expect(await response.json()).toEqual({ ok: true })
  expect(mocks.get).toHaveBeenCalledWith(request, params)
})

test('route and service import no mutation, provider, or scan runner modules', () => {
  const route = readFileSync('app/api/clients/[clientId]/work-items/[workItemId]/versions/[versionId]/outcomes/route.ts', 'utf8')
  const service = readFileSync('lib/outcomes/service.ts', 'utf8')
  expect(route + service).not.toMatch(/attestDelivery|withdrawDelivery|openrouter|provider|runScan|@\/lib\/scan(?:ner)?(?:['"]|\/)/)
})
