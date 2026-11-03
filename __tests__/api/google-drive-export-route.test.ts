import { beforeEach, describe, expect, it, vi } from 'vitest'

const getProfile = vi.hoisted(() => vi.fn())
const exportTurnToGoogleDoc = vi.hoisted(() => vi.fn())
vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ getProfile }))
vi.mock('@/lib/conversation-studio/drive-export', () => ({ exportTurnToGoogleDoc }))

const clientId = '33333333-3333-4333-8333-333333333333'
const threadId = '44444444-4444-4444-8444-444444444444'
const profile = { id: '11111111-1111-4111-8111-111111111111', account_id: '22222222-2222-4222-8222-222222222222', accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1' } }

function post(body: unknown, raw = false) {
  return new Request('https://app.test/api/x', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: raw ? String(body) : JSON.stringify(body) })
}
async function route(request = post({ threadId, position: 0, locale: 'zh-HK' }), id = clientId) {
  const { POST } = await import('@/app/api/dashboard/clients/[clientId]/studio/exports/google-docs/route')
  return POST(request, { params: Promise.resolve({ clientId: id }) })
}

beforeEach(() => {
  process.env.FEATURE_CONVERSATION_STUDIO = '1'
  getProfile.mockReset().mockResolvedValue(profile)
  exportTurnToGoogleDoc.mockReset().mockResolvedValue({ status: 201, body: { outcome: 'created', link: 'https://docs.google.com/document/d/f/edit' } })
})

describe('POST studio exports google-docs', () => {
  it('passes the session’s account and profile, never caller ids, and forbids caching', async () => {
    const res = await route()
    expect(res.status).toBe(201)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual({ outcome: 'created', link: 'https://docs.google.com/document/d/f/edit' })
    expect(exportTurnToGoogleDoc).toHaveBeenCalledWith({ accountId: profile.account_id, profileId: profile.id, clientId, threadId, position: 0, locale: 'zh-HK' })
  })

  it.each([
    [{ threadId, position: 0, accountId: 'x' }],
    [{ threadId: 'not-a-uuid', position: 0 }],
    [{ threadId, position: -1 }],
    [{ threadId, position: 1.5 }],
    [{ threadId, position: 0, locale: 'fr' }],
    [[threadId]],
  ])('is 400 INVALID_STUDIO_INPUT for %j', async body => {
    const res = await route(post(body))
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'INVALID_STUDIO_INPUT' })
    expect(exportTurnToGoogleDoc).not.toHaveBeenCalled()
  })

  it('is 400 for malformed JSON', async () => {
    expect((await route(post('{', true))).status).toBe(400)
  })

  it('is 404 for a malformed brand id, 401 signed out, 403 without platform access, 404 with Studio off', async () => {
    expect((await route(undefined, 'bad')).status).toBe(404)
    getProfile.mockResolvedValueOnce(null)
    expect((await route()).status).toBe(401)
    getProfile.mockResolvedValueOnce({ ...profile, accounts: { plan: 'free' } })
    expect((await route()).status).toBe(403)
    process.env.FEATURE_CONVERSATION_STUDIO = '0'
    expect((await route()).status).toBe(404)
    expect(exportTurnToGoogleDoc).not.toHaveBeenCalled()
  })

  it('relays service refusals with their status', async () => {
    exportTurnToGoogleDoc.mockResolvedValue({ status: 409, body: { error: 'DRIVE_NOT_CONNECTED' } })
    const res = await route()
    expect(res.status).toBe(409)
    expect(await res.json()).toEqual({ error: 'DRIVE_NOT_CONNECTED' })
  })
})
