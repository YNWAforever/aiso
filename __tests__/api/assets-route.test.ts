import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  profile: vi.fn(),
  listAssets: vi.fn(),
  listDeclarations: vi.fn(),
  register: vi.fn(),
  declare: vi.fn(),
  withdraw: vi.fn(),
}))

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ getProfile: mocks.profile }))
vi.mock('@/lib/assets/store', () => ({
  listAssets: mocks.listAssets,
  listQuestionDeclarations: mocks.listDeclarations,
  registerAsset: mocks.register,
  declareQuestion: mocks.declare,
  withdrawQuestion: mocks.withdraw,
}))

import { GET, POST } from '@/app/api/dashboard/clients/[clientId]/assets/route'
import { DELETE, POST as DECLARE } from '@/app/api/dashboard/clients/[clientId]/assets/declarations/route'

/**
 * The registered-page routes.
 *
 * Ownership is not checked in the handler and must not be: every statement in
 * lib/assets/store.ts carries `account_id`, so an unowned client produces no
 * row. What these cases pin is that the route reports that as a 404 rather than
 * a 200 with nothing in it, and that a rejected URL never reaches the store.
 */

const params = (clientId = 'client-1') => ({ params: Promise.resolve({ clientId }) })
const post = (body: unknown) => new Request('http://t/x', { method: 'POST', body: JSON.stringify(body) })

beforeEach(() => {
  vi.clearAllMocks()
  mocks.profile.mockResolvedValue({ id: 'profile-1', account_id: 'account-1' })
  mocks.listAssets.mockResolvedValue([])
  mocks.listDeclarations.mockResolvedValue([])
  mocks.register.mockResolvedValue({ id: 'asset-1', url: 'https://example.com/p', origin: 'https://example.com', label: 'P' })
  mocks.declare.mockResolvedValue(true)
  mocks.withdraw.mockResolvedValue(true)
})

describe('GET /api/dashboard/clients/[clientId]/assets', () => {
  it('denies an anonymous caller without touching the store', async () => {
    mocks.profile.mockResolvedValue(null)

    const response = await GET(new Request('http://t/x'), params())

    expect(response.status).toBe(401)
    expect(mocks.listAssets).not.toHaveBeenCalled()
  })

  it('reads only the caller’s own account', async () => {
    await GET(new Request('http://t/x'), params())

    expect(mocks.listAssets).toHaveBeenCalledWith('account-1', 'client-1')
    expect(mocks.listDeclarations).toHaveBeenCalledWith('account-1', 'client-1')
  })
})

describe('POST /api/dashboard/clients/[clientId]/assets', () => {
  it('denies an anonymous caller without writing', async () => {
    mocks.profile.mockResolvedValue(null)

    const response = await POST(post({ url: 'https://example.com/p', label: 'P' }), params())

    expect(response.status).toBe(401)
    expect(mocks.register).not.toHaveBeenCalled()
  })

  it.each([
    ['javascript:alert(1)', 'a non-web scheme'],
    ['https://user:pass@example.com/a', 'embedded credentials'],
    ['not a url', 'unparseable text'],
  ])('rejects %s (%s) before the store sees it', async url => {
    const response = await POST(post({ url, label: 'P' }), params())

    expect(response.status).toBe(400)
    expect(mocks.register).not.toHaveBeenCalled()
  })

  it('rejects a label that is empty or oversized', async () => {
    for (const label of ['', '   ', 'x'.repeat(161)]) {
      const response = await POST(post({ url: 'https://example.com/p', label }), params())
      expect(response.status).toBe(400)
    }
    expect(mocks.register).not.toHaveBeenCalled()
  })

  it('stores the normalised url and origin, not the raw input', async () => {
    await POST(post({ url: 'HTTPS://Example.COM/Pricing#plans', label: '  Pricing  page ' }), params())

    expect(mocks.register).toHaveBeenCalledWith(expect.objectContaining({
      accountId: 'account-1',
      clientId: 'client-1',
      url: 'https://example.com/Pricing',
      origin: 'https://example.com',
      label: 'Pricing page',
      actorId: 'profile-1',
    }))
  })

  it('reports a client that is absent or not yours as 404', async () => {
    // The store returns null for both, and the route must not distinguish them:
    // saying "exists but not yours" would confirm another account's id.
    mocks.register.mockResolvedValue(null)

    const response = await POST(post({ url: 'https://example.com/p', label: 'P' }), params())

    expect(response.status).toBe(404)
  })

  it('fails loudly when the write throws, rather than reporting success', async () => {
    mocks.register.mockRejectedValue(new Error('private-database-details'))

    const response = await POST(post({ url: 'https://example.com/p', label: 'P' }), params())

    expect(response.status).toBe(503)
    expect(await response.text()).not.toContain('private-database-details')
  })
})

describe('the declarations route', () => {
  it('denies an anonymous caller without writing', async () => {
    mocks.profile.mockResolvedValue(null)

    const response = await DECLARE(post({ assetId: 'asset-1', promptId: 'prompt-1' }), params())

    expect(response.status).toBe(401)
    expect(mocks.declare).not.toHaveBeenCalled()
  })

  it('declares that a page answers a question', async () => {
    const response = await DECLARE(post({ assetId: 'asset-1', promptId: 'prompt-1' }), params())

    expect(response.status).toBe(200)
    expect(mocks.declare).toHaveBeenCalledWith({
      accountId: 'account-1', clientId: 'client-1',
      assetId: 'asset-1', promptId: 'prompt-1', actorId: 'profile-1',
    })
  })

  it('reports 404 when the asset or the prompt is not this account’s', async () => {
    // The store's insert joins prompt_bank on the asset's own client_id, so a
    // foreign prompt inserts nothing. That must read as "not found", not "ok".
    mocks.declare.mockResolvedValue(false)

    const response = await DECLARE(post({ assetId: 'asset-1', promptId: 'prompt-1' }), params())

    expect(response.status).toBe(404)
  })

  it('withdraws a declaration, and 404s when there was none', async () => {
    expect((await DELETE(post({ assetId: 'asset-1', promptId: 'prompt-1' }), params())).status).toBe(200)

    mocks.withdraw.mockResolvedValue(false)
    expect((await DELETE(post({ assetId: 'asset-1', promptId: 'prompt-1' }), params())).status).toBe(404)
  })

  it('rejects a malformed body without writing', async () => {
    const response = await DECLARE(post({ assetId: '', promptId: '' }), params())

    expect(response.status).toBe(400)
    expect(mocks.declare).not.toHaveBeenCalled()
  })
})
