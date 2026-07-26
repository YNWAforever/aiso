import { describe, it, expect, vi, beforeEach } from 'vitest'

const getProfileMock = vi.fn()
vi.mock('@/lib/auth', () => ({ getProfile: () => getProfileMock() }))

async function guard() {
  const { requireApiAdmin } = await import('@/lib/admin-guard')
  return requireApiAdmin()
}

describe('requireApiAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.resetModules()
  })

  it('returns 401 when signed out', async () => {
    getProfileMock.mockResolvedValue(null)
    const result = await guard()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(401)
      expect(await result.response.json()).toEqual({ error: 'Unauthorized' })
    }
  })

  it('returns 403 for a signed-in non-admin', async () => {
    getProfileMock.mockResolvedValue({ id: 'p1', account_id: 'a1', is_admin: false })
    const result = await guard()
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.response.status).toBe(403)
      expect(await result.response.json()).toEqual({ error: 'Forbidden' })
    }
  })

  it('returns the profile for an admin', async () => {
    getProfileMock.mockResolvedValue({ id: 'p1', account_id: 'a1', is_admin: true })
    const result = await guard()
    expect(result.ok).toBe(true)
    if (result.ok) expect(result.profile.id).toBe('p1')
  })

  it('propagates a getProfile() rejection instead of swallowing it into a response', async () => {
    getProfileMock.mockRejectedValue(new Error('boom'))
    await expect(guard()).rejects.toThrow('boom')
  })
})
