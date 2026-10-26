import { describe, expect, it, vi } from 'vitest'
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db', () => ({ db: vi.fn() }))
import { submitIndexNow } from '@/lib/outcome-integrations/indexnow'

const scope = { accountId: 'account', clientId: 'client' }
const key = '12345678abcdef00'
function fixture() {
  return { key: async () => ({ key, domain: 'example.com' }),
    begin: vi.fn(async () => ({ claimed: true, attempt: { id: 'attempt', status: 'running', reason: null, startedAt: 'now' } })),
    finish: vi.fn(async () => {}),
    fetch: vi.fn(async (url: string | URL | Request) => new Response(String(url).includes('indexnow.org') ? '' : key, { status: 200 })) }
}
describe('IndexNow bounded verified submissions', () => {
  it('verifies a same-origin key file before sending owned URLs and records acceptance', async () => {
    const deps = fixture()
    expect(await submitIndexNow(scope, { intentKey: 'intent:0001', urls: ['https://example.com/a'] }, deps)).toMatchObject({ status: 'succeeded', reason: 'ACCEPTED_NOT_INDEXING_PROOF' })
    expect(deps.fetch.mock.calls.map(call => String(call[0]))).toEqual([`https://example.com/${key}.txt`, 'https://api.indexnow.org/indexnow'])
    expect(deps.finish).toHaveBeenCalledWith(scope, 'attempt', 'succeeded', 'ACCEPTED_NOT_INDEXING_PROOF', 200)
  })
  it('refuses changed/foreign hosts before any provider call', async () => {
    const deps = fixture()
    await expect(submitIndexNow(scope, { intentKey: 'intent:0001', urls: ['https://foreign.example/a'] }, deps)).rejects.toThrow('INVALID_OUTCOME_INPUT')
    expect(deps.fetch).not.toHaveBeenCalled()
  })
  it('does not repeat a previously claimed submission', async () => {
    const deps = fixture(); deps.begin.mockResolvedValue({ claimed: false, attempt: { id: 'attempt', status: 'unknown', reason: null, startedAt: 'now' } })
    expect(await submitIndexNow(scope, { intentKey: 'intent:0001', urls: ['https://example.com/a'] }, deps)).toMatchObject({ status: 'unknown' })
    expect(deps.fetch).not.toHaveBeenCalled()
  })
  it('blocks a mismatched key file and never submits', async () => {
    const deps = fixture(); deps.fetch.mockResolvedValue(new Response('other'))
    expect(await submitIndexNow(scope, { intentKey: 'intent:0001', urls: ['https://example.com/a'] }, deps)).toMatchObject({ status: 'blocked' })
    expect(deps.fetch).toHaveBeenCalledTimes(1)
  })
  it('records an ambiguous send as unknown without logging provider data', async () => {
    const deps = fixture(); deps.fetch.mockResolvedValueOnce(new Response(key)).mockRejectedValueOnce(new Error('secret prompt'))
    expect(await submitIndexNow(scope, { intentKey: 'intent:0001', urls: ['https://example.com/a'] }, deps)).toMatchObject({ status: 'unknown', reason: 'DELIVERY_UNCONFIRMED' })
    expect(deps.finish).toHaveBeenCalledWith(scope, 'attempt', 'unknown', 'DELIVERY_UNCONFIRMED', null)
  })
})
