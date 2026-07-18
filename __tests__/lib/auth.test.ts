import { describe, it, expect, vi, beforeEach } from 'vitest'

const getSessionMock = vi.fn()
vi.mock('@/lib/neon-auth', () => ({
  auth: () => ({ getSession: getSessionMock }),
}))

const sqlMock = vi.fn()
vi.mock('@/lib/db', () => ({ db: () => sqlMock }))

const redirectMock = vi.fn((url: string) => { throw new Error(`REDIRECT:${url}`) })
vi.mock('next/navigation', () => ({ redirect: redirectMock }))

describe('lib/auth', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('getProfile returns null when there is no session', async () => {
    getSessionMock.mockResolvedValue({ data: null, error: null })
    const { getProfile } = await import('@/lib/auth')
    expect(await getProfile()).toBeNull()
  })

  it('getProfile throws when Neon Auth resolves a session error', async () => {
    const sdkError = { code: 'session_unavailable', message: 'Neon Auth unavailable' }
    getSessionMock.mockResolvedValue({ data: null, error: sdkError })
    const { getProfile } = await import('@/lib/auth')

    await expect(getProfile()).rejects.toBe(sdkError)
    expect(sqlMock).not.toHaveBeenCalled()
  })

  it('getProfile returns null when the session has no matching profile row', async () => {
    getSessionMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'a@b.com' } }, error: null })
    sqlMock.mockResolvedValue([])
    const { getProfile } = await import('@/lib/auth')
    expect(await getProfile()).toBeNull()
  })

  it('getProfile returns the profile with account and attached email', async () => {
    getSessionMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'a@b.com' } }, error: null })
    sqlMock.mockResolvedValue([{
      id: 'user-1', account_id: 'acc-1', display_name: 'A', is_admin: false,
      created_at: '2026-01-01T00:00:00Z',
      account_id_2: 'acc-1', plan: 'basic', status: 'active',
      stripe_customer_id: null, stripe_subscription_id: null,
      trial_started_at: null, trial_ends_at: null, trial_emails_sent: 0,
      account_created_at: '2026-01-01T00:00:00Z',
    }])
    const { getProfile } = await import('@/lib/auth')
    const profile = await getProfile()
    expect(profile?.email).toBe('a@b.com')
    expect(profile?.accounts.plan).toBe('basic')
  })

  it('requireAuth redirects to login when there is no profile', async () => {
    getSessionMock.mockResolvedValue({ data: null, error: null })
    const { requireAuth } = await import('@/lib/auth')
    await expect(requireAuth('en')).rejects.toThrow('REDIRECT:/en/auth/login')
  })

  it('requireAdmin redirects to dashboard when the profile is not an admin', async () => {
    getSessionMock.mockResolvedValue({ data: { user: { id: 'user-1', email: 'a@b.com' } }, error: null })
    sqlMock.mockResolvedValue([{
      id: 'user-1', account_id: 'acc-1', display_name: 'A', is_admin: false,
      created_at: '2026-01-01T00:00:00Z',
      account_id_2: 'acc-1', plan: 'basic', status: 'active',
      stripe_customer_id: null, stripe_subscription_id: null,
      trial_started_at: null, trial_ends_at: null, trial_emails_sent: 0,
      account_created_at: '2026-01-01T00:00:00Z',
    }])
    const { requireAdmin } = await import('@/lib/auth')
    await expect(requireAdmin('en')).rejects.toThrow('REDIRECT:/en/dashboard')
  })
})
