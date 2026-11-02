import { beforeEach, describe, expect, it, vi } from 'vitest'

const getProfile = vi.hoisted(() => vi.fn())
const sql = vi.hoisted(() => vi.fn())
const queryStudioDfs = vi.hoisted(() => vi.fn())
const setStudioDfsBrandEnabled = vi.hoisted(() => vi.fn())
const isFeatureEnabled = vi.hoisted(() => vi.fn())
const resolveCommercialEntitlement = vi.hoisted(() => vi.fn())

vi.mock('server-only', () => ({}))
vi.mock('@/lib/auth', () => ({ getProfile }))
vi.mock('@/lib/db', () => ({ db: () => sql }))
vi.mock('@/lib/flags', () => ({ isFeatureEnabled }))
vi.mock('@/lib/tier', () => ({ resolveCommercialEntitlement }))
vi.mock('@/lib/conversation-studio/dfs-query', () => ({ queryStudioDfs, setStudioDfsBrandEnabled }))

const clientId = '11111111-1111-4111-8111-111111111111'
const profile = { id: 'p', account_id: 'account-a', is_admin: false }

function post(body?: unknown) {
  return new Request('https://app.test/api/studio/dataforseo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
}

async function dataRoute(request = post({ keyword: 'sourdough' }), id = clientId) {
  const { POST } = await import('@/app/api/dashboard/clients/[clientId]/studio/dataforseo/route')
  return POST(request, { params: Promise.resolve({ clientId: id }) })
}

async function settingsRoute(request = post({ enabled: true }), id = clientId) {
  const { POST } = await import('@/app/api/dashboard/clients/[clientId]/studio/dataforseo/settings/route')
  return POST(request, { params: Promise.resolve({ clientId: id }) })
}

beforeEach(() => {
  getProfile.mockReset().mockResolvedValue(profile)
  sql.mockReset().mockResolvedValue([{ id: clientId, account_id: 'account-a', status: 'active' }])
  queryStudioDfs.mockReset().mockResolvedValue({ status: 'ok', locationPending: true, week: { weekStart: '2026-11-02', timeZone: 'Asia/Hong_Kong', remaining: 19, cap: 20 } })
  setStudioDfsBrandEnabled.mockReset().mockResolvedValue(undefined)
  isFeatureEnabled.mockReset().mockReturnValue(true)
  resolveCommercialEntitlement.mockReset().mockReturnValue({ features: { platform_access: ['gemini'] } })
})

describe('POST studio dataforseo', () => {
  it('uses the owner profile, passes the keyword and forbids caching', async () => {
    const response = await dataRoute()
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(getProfile).toHaveBeenCalled()
    expect(sql.mock.calls[0]![1]).toBe(clientId)
    expect(sql.mock.calls[0]![2]).toBe('account-a')
    expect(queryStudioDfs).toHaveBeenCalledWith({ accountId: 'account-a', clientId, keyword: 'sourdough' })
    expect(await response.json()).toMatchObject({ snapshot: { status: 'ok', locationPending: true } })
  })

  it('is 401 unauthenticated', async () => {
    getProfile.mockResolvedValue(null)
    expect((await dataRoute()).status).toBe(401)
    expect(queryStudioDfs).not.toHaveBeenCalled()
  })

  it('is 404 for a foreign, inactive or malformed brand before any vendor work', async () => {
    expect((await dataRoute(post({ keyword: 'q' }), 'bad-id')).status).toBe(404)
    sql.mockResolvedValue([])
    expect((await dataRoute()).status).toBe(404)
    sql.mockResolvedValue([{ id: clientId, account_id: 'account-a', status: 'archived' }])
    expect((await dataRoute()).status).toBe(404)
    expect(queryStudioDfs).not.toHaveBeenCalled()
  })

  it('rejects extra or non-string body keys', async () => {
    expect((await dataRoute(post({ keyword: 'q', secret: 'x' }))).status).toBe(400)
    expect((await dataRoute(post({ keyword: 4 }))).status).toBe(400)
    expect(queryStudioDfs).not.toHaveBeenCalled()
  })

  it('is 400 for malformed JSON instead of an unavailable snapshot', async () => {
    const request = new Request('https://app.test/api/studio/dataforseo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{',
    })
    const response = await dataRoute(request)
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ error: 'INVALID_STUDIO_INPUT' })
    expect(queryStudioDfs).not.toHaveBeenCalled()
  })

  it('is 403 UPGRADE_REQUIRED for a non-entitled account before brand or quota work', async () => {
    resolveCommercialEntitlement.mockReturnValue({ features: { platform_access: [] } })
    const response = await dataRoute()
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'UPGRADE_REQUIRED' })
    expect(sql).not.toHaveBeenCalled()
    expect(queryStudioDfs).not.toHaveBeenCalled()
  })

  it('turns an unexpected dependency failure into an honest no-store snapshot', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    queryStudioDfs.mockRejectedValue(new Error('DEPENDENCY_UNAVAILABLE'))
    try {
      const response = await dataRoute()
      expect(response.status).toBe(200)
      expect(response.headers.get('Cache-Control')).toBe('no-store')
      expect(await response.json()).toMatchObject({ snapshot: { status: 'unavailable', locationPending: true } })
    } finally { error.mockRestore() }
  })

  it('is 404 when the Studio feature is off', async () => {
    isFeatureEnabled.mockReturnValue(false)
    expect((await dataRoute()).status).toBe(404)
    expect(getProfile).not.toHaveBeenCalled()
  })
})

describe('POST studio dataforseo settings', () => {
  it('stores the toggle for the owning account and forbids caching', async () => {
    const response = await settingsRoute(post({ enabled: false }))
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(setStudioDfsBrandEnabled).toHaveBeenCalledWith({
      accountId: 'account-a', clientId, enabled: false, updatedBy: 'p',
    })
    expect(await response.json()).toEqual({ enabled: false })
  })

  it('rejects missing or non-boolean enabled', async () => {
    expect((await settingsRoute(post({ enabled: 'yes' }))).status).toBe(400)
    expect((await settingsRoute(post({ enabled: true, extra: 1 }))).status).toBe(400)
    expect((await settingsRoute(post({}))).status).toBe(400)
    expect(setStudioDfsBrandEnabled).not.toHaveBeenCalled()
  })

  it('denies a non-owner brand with 404', async () => {
    getProfile.mockResolvedValue({ ...profile, is_admin: false })
    sql.mockResolvedValue([])
    expect((await settingsRoute()).status).toBe(404)
    expect(setStudioDfsBrandEnabled).not.toHaveBeenCalled()
  })

  it('does not let a platform admin toggle a brand from another account', async () => {
    getProfile.mockResolvedValue({ ...profile, is_admin: true, account_id: 'account-other' })
    sql.mockResolvedValue([])
    expect((await settingsRoute(post({ enabled: true }))).status).toBe(404)
    expect(setStudioDfsBrandEnabled).not.toHaveBeenCalled()
  })

  it('is 403 UPGRADE_REQUIRED for a non-entitled account before brand work', async () => {
    resolveCommercialEntitlement.mockReturnValue({ features: { platform_access: [] } })
    const response = await settingsRoute()
    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({ error: 'UPGRADE_REQUIRED' })
    expect(sql).not.toHaveBeenCalled()
    expect(setStudioDfsBrandEnabled).not.toHaveBeenCalled()
  })

  it('is 401 unauthenticated and 404 when the feature is off', async () => {
    getProfile.mockResolvedValue(null)
    expect((await settingsRoute()).status).toBe(401)
    getProfile.mockResolvedValue(profile)
    isFeatureEnabled.mockReturnValue(false)
    expect((await settingsRoute()).status).toBe(404)
    expect(setStudioDfsBrandEnabled).not.toHaveBeenCalled()
  })
})
