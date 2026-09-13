import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
  readOwnedDraft: vi.fn(),
  loadOwnedDraftSource: vi.fn(),
  deriveSuggestions: vi.fn(),
  buildInitialDraftSnapshot: vi.fn(),
  attach: vi.fn(),
  withdraw: vi.fn(),
  listLiveSources: vi.fn(),
}))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ getProfile: mocks.profile }))
vi.mock('@/lib/work-items/store', () => ({ readOwnedDraft: mocks.readOwnedDraft, loadOwnedDraftSource: mocks.loadOwnedDraftSource }))
vi.mock('@/lib/opportunities/rules', () => ({ deriveSuggestions: mocks.deriveSuggestions }))
vi.mock('@/lib/work-items/snapshot', () => ({ buildInitialDraftSnapshot: mocks.buildInitialDraftSnapshot }))
vi.mock('@/lib/work-items/sources', () => ({
  attachSource: mocks.attach, withdrawSource: mocks.withdraw, listLiveSources: mocks.listLiveSources,
}))

import { POST, DELETE } from '@/app/api/dashboard/clients/[clientId]/work-items/[itemId]/sources/route'

const ACCOUNT = '11111111-1111-4111-8111-111111111111'
const KEY = 'scan-check-gap.v1:scan-check:22222222-2222-4222-8222-222222222222:c9_meta_desc'
const SUGGESTION = {
  key: KEY, ruleVersion: 'scan-check-gap.v1',
  source: { kind: 'scan-check' as const, id: '22222222-2222-4222-8222-222222222222', checkKey: 'c9_meta_desc' as const },
  fingerprint: 'f'.repeat(64), titleKey: 'review-check' as const, actionKey: 'review-check' as const,
  args: {}, evidence: {} as never, limitations: [], savedDraftId: null,
}

const params = () => ({ params: Promise.resolve({ clientId: 'client-1', itemId: 'item-1' }) })
const post = (body: unknown) => new Request('https://example.test', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  vi.resetAllMocks()
  mocks.profile.mockResolvedValue({ id: 'actor-1', account_id: ACCOUNT })
  process.env.WORK_ITEM_MULTI_SOURCE_V1 = '1'
  mocks.readOwnedDraft.mockResolvedValue({ id: 'item-1', locale: 'en' })
  mocks.loadOwnedDraftSource.mockResolvedValue({ source: {}, version: 'v' })
  mocks.deriveSuggestions.mockReturnValue([SUGGESTION])
  mocks.buildInitialDraftSnapshot.mockReturnValue({ schemaVersion: 1 })
  mocks.attach.mockResolvedValue(true)
  mocks.withdraw.mockResolvedValue(true)
  mocks.listLiveSources.mockResolvedValue([])
})

describe('POST /work-items/:itemId/sources', () => {
  it('denies an anonymous caller without writing', async () => {
    mocks.profile.mockResolvedValue(null)

    const response = await POST(post({ opportunityKey: KEY }), params())

    expect(response.status).toBe(401)
    expect(mocks.attach).not.toHaveBeenCalled()
  })

  it('refuses when the flag is off', async () => {
    // With the flag off every item has exactly one source, which is the
    // pre-051 behaviour this release must be able to fall back to.
    delete process.env.WORK_ITEM_MULTI_SOURCE_V1

    const response = await POST(post({ opportunityKey: KEY }), params())

    expect(response.status).toBe(404)
    expect(mocks.attach).not.toHaveBeenCalled()
  })

  it('rejects a body without a non-empty string opportunityKey', async () => {
    for (const body of [{}, { opportunityKey: '' }, { opportunityKey: 42 }]) {
      expect((await POST(post(body), params())).status).toBe(400)
    }
    expect(mocks.attach).not.toHaveBeenCalled()
  })

  it('rejects a malformed opportunityKey before deriving anything', async () => {
    expect((await POST(post({ opportunityKey: 'not-a-real-key' }), params())).status).toBe(400)
    expect(mocks.loadOwnedDraftSource).not.toHaveBeenCalled()
  })

  it('refuses an opportunity whose evidence no longer derives', async () => {
    mocks.deriveSuggestions.mockReturnValue([])

    const response = await POST(post({ opportunityKey: KEY }), params())

    expect(response.status).toBe(409)
    expect(mocks.attach).not.toHaveBeenCalled()
  })

  it('refuses when the source can no longer be loaded at all', async () => {
    mocks.loadOwnedDraftSource.mockResolvedValue(null)

    expect((await POST(post({ opportunityKey: KEY }), params())).status).toBe(409)
    expect(mocks.attach).not.toHaveBeenCalled()
  })

  it('refuses when the snapshot cannot be built, without attaching', async () => {
    mocks.buildInitialDraftSnapshot.mockImplementation(() => { throw new Error('limited evidence') })

    expect((await POST(post({ opportunityKey: KEY }), params())).status).toBe(409)
    expect(mocks.attach).not.toHaveBeenCalled()
  })

  it('attaches a validated source', async () => {
    const response = await POST(post({ opportunityKey: KEY }), params())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ attached: true })
    expect(mocks.attach).toHaveBeenCalledWith(expect.objectContaining({ accountId: ACCOUNT }))
  })

  it('builds the snapshot using the item\'s own locale, not a caller-supplied one', async () => {
    mocks.readOwnedDraft.mockResolvedValue({ id: 'item-1', locale: 'zh-HK' })

    await POST(post({ opportunityKey: KEY }), params())

    expect(mocks.buildInitialDraftSnapshot).toHaveBeenCalledWith(SUGGESTION, expect.anything(), 'zh-HK')
  })

  it('reports an item that is absent or not yours as 404', async () => {
    mocks.attach.mockResolvedValue(false)

    expect((await POST(post({ opportunityKey: KEY }), params())).status).toBe(404)
  })

  it('reports a missing work item as 404 before deriving anything', async () => {
    mocks.readOwnedDraft.mockResolvedValue(null)

    expect((await POST(post({ opportunityKey: KEY }), params())).status).toBe(404)
    expect(mocks.loadOwnedDraftSource).not.toHaveBeenCalled()
  })
})

describe('DELETE /work-items/:itemId/sources', () => {
  it('denies an anonymous caller without writing', async () => {
    mocks.profile.mockResolvedValue(null)

    expect((await DELETE(post({ opportunityKey: KEY }), params())).status).toBe(401)
    expect(mocks.withdraw).not.toHaveBeenCalled()
  })

  it('refuses when the flag is off', async () => {
    delete process.env.WORK_ITEM_MULTI_SOURCE_V1

    expect((await DELETE(post({ opportunityKey: KEY }), params())).status).toBe(404)
    expect(mocks.withdraw).not.toHaveBeenCalled()
  })

  it('withdraws a live source', async () => {
    const response = await DELETE(post({ opportunityKey: KEY }), params())

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ withdrawn: true })
  })

  it('refuses to withdraw the last source with 409, not 404', async () => {
    // 404 would read as "no such source". The source exists; the rule refuses.
    mocks.withdraw.mockResolvedValue(false)
    mocks.listLiveSources.mockResolvedValue([{ opportunityKey: KEY }])

    expect((await DELETE(post({ opportunityKey: KEY }), params())).status).toBe(409)
  })

  it('reports an absent, foreign, or already-withdrawn source as 404', async () => {
    mocks.withdraw.mockResolvedValue(false)
    mocks.listLiveSources.mockResolvedValue([{ opportunityKey: 'some-other-key' }])

    expect((await DELETE(post({ opportunityKey: KEY }), params())).status).toBe(404)
  })
})
