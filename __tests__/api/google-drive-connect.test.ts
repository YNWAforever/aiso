import { randomBytes } from 'node:crypto'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NextRequest } from 'next/server'
import {
  GOOGLE_CONSENT_COOKIE, GOOGLE_DRIVE_CONSENT_COOKIE, signConsentState, verifyConsentState,
} from '@/lib/integrations/google/consent-state'
import { DRIVE_FILE_SCOPE, SEARCH_CONSOLE_SCOPE } from '@/lib/integrations/google/oauth'
import { openToken, sealToken } from '@/lib/integrations/google/vault'

const getProfile = vi.hoisted(() => vi.fn())
const exchangeCode = vi.hoisted(() => vi.fn())
const revokeToken = vi.hoisted(() => vi.fn())
const upsertConnection = vi.hoisted(() => vi.fn())
const drive = vi.hoisted(() => ({
  upsertDriveConnection: vi.fn(),
  loadDriveConnection: vi.fn(),
  loadDriveSecret: vi.fn(),
  revokeDriveConnectionRow: vi.fn(),
}))
vi.mock('@/lib/auth', () => ({ getProfile }))
vi.mock('@/lib/integrations/search-console/store', () => ({ upsertConnection }))
vi.mock('@/lib/integrations/google-drive/store', () => drive)
vi.mock('@/lib/integrations/google/oauth', async importOriginal => ({ ...(await importOriginal<object>()), exchangeCode, revokeToken }))

const profile = {
  id: '11111111-1111-4111-8111-111111111111',
  account_id: '22222222-2222-4222-8222-222222222222',
  accounts: { plan: 'pro', status: 'active', stripe_subscription_id: 'sub_1' },
}
const returnPath = '/en/dashboard/33333333-3333-4333-8333-333333333333/studio/connections'
const state = randomBytes(32).toString('base64url')
const verifier = randomBytes(48).toString('base64url')

function driveCookie(purpose: 'drive' | 'search_console' = 'drive', overrides: Partial<{ profileId: string }> = {}) {
  return signConsentState({ state, verifier, profileId: overrides.profileId ?? profile.id, accountId: profile.account_id, returnPath }, Date.now(), purpose)
}

function callback(query: string, cookies: Record<string, string>) {
  const req = new NextRequest(`https://app.test/api/integrations/google/callback${query}`)
  for (const [name, value] of Object.entries(cookies)) req.cookies.set(name, value)
  return import('@/app/api/integrations/google/callback/route').then(({ GET }) => GET(req))
}

beforeEach(() => {
  Object.assign(process.env, {
    FEATURE_CONVERSATION_STUDIO: '1', FEATURE_SEARCH_CONSOLE: '0',
    GOOGLE_OAUTH_CLIENT_ID: 'cid', GOOGLE_OAUTH_CLIENT_SECRET: 'cs',
    GOOGLE_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('base64'),
    REPORT_SHARE_SECRET: 'drive-consent-route-test-secret-0123456789abcdef',
    NEXT_PUBLIC_APP_URL: 'https://app.test',
  })
  getProfile.mockReset().mockResolvedValue(profile)
  exchangeCode.mockReset().mockResolvedValue({
    accessToken: 'access', refreshToken: 'UNIT_REFRESH_TOKEN', subject: 'google-sub', email: 'member@example.com',
    scopes: ['openid', 'email', DRIVE_FILE_SCOPE],
  })
  revokeToken.mockReset().mockResolvedValue(true)
  upsertConnection.mockReset().mockResolvedValue('conn-1')
  drive.upsertDriveConnection.mockReset().mockResolvedValue(undefined)
  drive.loadDriveConnection.mockReset().mockResolvedValue({ status: 'active', googleEmail: 'member@example.com' })
  drive.loadDriveSecret.mockReset()
  drive.revokeDriveConnectionRow.mockReset().mockResolvedValue(true)
})

describe('GET drive start', () => {
  const start = async (query = '') => {
    const { GET } = await import('@/app/api/integrations/google/drive/start/route')
    return GET(new NextRequest(`https://app.test/api/integrations/google/drive/start${query}`))
  }

  it('asks Google for drive.file only and sets a Drive-signed consent cookie on the callback path', async () => {
    const res = await start(`?return=${returnPath}`)
    expect(res.status).toBe(302)
    const location = new URL(res.headers.get('location')!)
    expect(location.origin).toBe('https://accounts.google.com')
    expect(location.searchParams.get('scope')).toBe(`openid email ${DRIVE_FILE_SCOPE}`)
    expect(location.searchParams.get('scope')).not.toContain(SEARCH_CONSOLE_SCOPE)
    expect(location.searchParams.get('redirect_uri')).toBe('https://app.test/api/integrations/google/callback')
    const cookie = res.cookies.get(GOOGLE_DRIVE_CONSENT_COOKIE)
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/api/integrations/google' })
    expect(res.cookies.get(GOOGLE_CONSENT_COOKIE)).toBeUndefined()
    expect(verifyConsentState(cookie?.value, Date.now(), 'drive')).toMatchObject({ profileId: profile.id, returnPath })
    // Domain-separated: the Drive token never verifies as a Search Console one.
    expect(verifyConsentState(cookie?.value)).toBeNull()
  })

  it('falls back to the dashboard for an unsafe return path', async () => {
    const res = await start('?return=https://evil.example/')
    expect(verifyConsentState(res.cookies.get(GOOGLE_DRIVE_CONSENT_COOKIE)?.value, Date.now(), 'drive')?.returnPath).toBe('/en/dashboard')
  })

  it('does not depend on the Search Console flag or entitlement', async () => {
    process.env.FEATURE_SEARCH_CONSOLE = '0'
    expect((await start()).status).toBe(302)
  })

  it('is 404 with Studio off, 401 signed out, 403 without platform access', async () => {
    process.env.FEATURE_CONVERSATION_STUDIO = '0'
    expect((await start()).status).toBe(404)
    process.env.FEATURE_CONVERSATION_STUDIO = '1'
    getProfile.mockResolvedValueOnce(null)
    expect((await start()).status).toBe(401)
    getProfile.mockResolvedValueOnce({ ...profile, accounts: { plan: 'free' } })
    const denied = await start()
    expect(denied.status).toBe(403)
    expect(await denied.json()).toEqual({ error: 'UPGRADE_REQUIRED' })
  })

  it('refuses before redirecting when the vault key is missing', async () => {
    delete process.env.GOOGLE_TOKEN_ENCRYPTION_KEY
    expect((await start()).status).toBe(500)
  })
})

describe('shared callback, Drive hand-off', () => {
  it('stores a drive.file grant sealed for this profile and never touches Search Console', async () => {
    const res = await callback(`?state=${state}&code=abc`, { [GOOGLE_DRIVE_CONSENT_COOKIE]: driveCookie() })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe(`https://app.test${returnPath}?drive=connected`)
    expect(res.cookies.get(GOOGLE_DRIVE_CONSENT_COOKIE)?.value).toBe('')
    expect(upsertConnection).not.toHaveBeenCalled()
    expect(drive.upsertDriveConnection).toHaveBeenCalledTimes(1)
    const input = drive.upsertDriveConnection.mock.calls[0]![0]
    expect(input).toMatchObject({ accountId: profile.account_id, profileId: profile.id, subject: 'google-sub', email: 'member@example.com' })
    expect(input.sealed.ciphertext.toString()).not.toContain('UNIT_REFRESH_TOKEN')
    const purpose = `drive:${profile.id}`
    expect(openToken(input.sealed, { accountId: profile.account_id, purpose })).toBe('UNIT_REFRESH_TOKEN')
    expect(() => openToken(input.sealed, { accountId: profile.account_id })).toThrow()
    expect(() => openToken(input.sealed, { accountId: profile.account_id, purpose: 'drive:44444444-4444-4444-8444-444444444444' })).toThrow()
  })

  it.each([
    ['scope_missing', { scopes: ['openid', 'email', SEARCH_CONSOLE_SCOPE] }],
    ['no_refresh_token', { refreshToken: null }],
  ])('refuses with %s and stores nothing', async (reason, grant) => {
    exchangeCode.mockResolvedValue({ accessToken: 'a', refreshToken: 'r', subject: 's', email: null, scopes: [DRIVE_FILE_SCOPE], ...grant })
    const res = await callback(`?state=${state}&code=abc`, { [GOOGLE_DRIVE_CONSENT_COOKIE]: driveCookie() })
    expect(res.headers.get('location')).toBe(`https://app.test${returnPath}?drive=error&reason=${reason}`)
    expect(drive.upsertDriveConnection).not.toHaveBeenCalled()
  })

  it('never reports connected over a failed write', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    drive.upsertDriveConnection.mockRejectedValue(new Error('postgresql://user:secret@host/db'))
    try {
      const res = await callback(`?state=${state}&code=abc`, { [GOOGLE_DRIVE_CONSENT_COOKIE]: driveCookie() })
      expect(res.headers.get('location')).toBe(`https://app.test${returnPath}?drive=error&reason=unavailable`)
      expect(error.mock.calls.flat().join(' ')).not.toContain('postgresql://')
    } finally { error.mockRestore() }
  })

  it('refuses a consent started by a different member', async () => {
    const res = await callback(`?state=${state}&code=abc`, {
      [GOOGLE_DRIVE_CONSENT_COOKIE]: driveCookie('drive', { profileId: '55555555-5555-4555-8555-555555555555' }),
    })
    expect(res.headers.get('location')).toContain('drive=error&reason=session_mismatch')
    expect(exchangeCode).not.toHaveBeenCalled()
  })

  it('maps a declined consent to denied', async () => {
    const res = await callback(`?state=${state}&error=access_denied`, { [GOOGLE_DRIVE_CONSENT_COOKIE]: driveCookie() })
    expect(res.headers.get('location')).toContain('drive=error&reason=denied')
  })

  it('leaves the Search Console path in charge when the Drive state does not match', async () => {
    process.env.FEATURE_SEARCH_CONSOLE = '1'
    const otherState = randomBytes(32).toString('base64url')
    const sc = signConsentState({ state: otherState, verifier, profileId: profile.id, accountId: profile.account_id, returnPath: '/en/dashboard/settings' })
    exchangeCode.mockResolvedValue({ accessToken: 'a', refreshToken: 'r', subject: 's', email: null, scopes: [SEARCH_CONSOLE_SCOPE] })
    const res = await callback(`?state=${otherState}&code=abc`, { [GOOGLE_DRIVE_CONSENT_COOKIE]: driveCookie(), [GOOGLE_CONSENT_COOKIE]: sc })
    expect(res.headers.get('location')).toBe('https://app.test/en/dashboard/settings?google=connected')
    expect(upsertConnection).toHaveBeenCalledTimes(1)
    expect(drive.upsertDriveConnection).not.toHaveBeenCalled()
  })

  it('ignores a Drive cookie signed under the Search Console domain', async () => {
    const res = await callback(`?state=${state}&code=abc`, { [GOOGLE_DRIVE_CONSENT_COOKIE]: driveCookie('search_console') })
    // Falls through to Search Console, which is switched off here.
    expect(res.status).toBe(404)
    expect(drive.upsertDriveConnection).not.toHaveBeenCalled()
  })
})

describe('account Drive connection route', () => {
  const route = () => import('@/app/api/account/integrations/google-drive/route')

  it('returns only the member’s own connection summary, no-store', async () => {
    const res = await (await route()).GET()
    expect(res.status).toBe(200)
    expect(res.headers.get('Cache-Control')).toBe('no-store')
    expect(await res.json()).toEqual({ connection: { status: 'active', googleEmail: 'member@example.com' } })
    expect(drive.loadDriveConnection).toHaveBeenCalledWith(profile.account_id, profile.id)
  })

  it('is 503 when the lookup fails, never an empty connection', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    drive.loadDriveConnection.mockRejectedValue(new Error('down'))
    try { expect((await (await route()).GET()).status).toBe(503) } finally { error.mockRestore() }
  })

  it('revokes at Google with the Drive-sealed token, then deletes the credential', async () => {
    drive.loadDriveSecret.mockResolvedValue(sealToken('UNIT_REFRESH_TOKEN', { accountId: profile.account_id, purpose: `drive:${profile.id}` }))
    const res = await (await route()).DELETE()
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ revoked: true, googleRevoked: true })
    expect(revokeToken).toHaveBeenCalledWith('UNIT_REFRESH_TOKEN')
    expect(drive.revokeDriveConnectionRow).toHaveBeenCalledWith(profile.account_id, profile.id)
  })

  it('still deletes our copy when Google refuses the revoke', async () => {
    drive.loadDriveSecret.mockResolvedValue(sealToken('t', { accountId: profile.account_id, purpose: `drive:${profile.id}` }))
    revokeToken.mockResolvedValue(false)
    expect(await (await (await route()).DELETE()).json()).toEqual({ revoked: true, googleRevoked: false })
    expect(drive.revokeDriveConnectionRow).toHaveBeenCalled()
  })

  it('is 404 with nothing to disconnect and 503 over a failed delete', async () => {
    drive.loadDriveSecret.mockResolvedValue(null)
    expect((await (await route()).DELETE()).status).toBe(404)
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    drive.loadDriveSecret.mockResolvedValue(sealToken('t', { accountId: profile.account_id, purpose: `drive:${profile.id}` }))
    drive.revokeDriveConnectionRow.mockRejectedValue(new Error('down'))
    try { expect((await (await route()).DELETE()).status).toBe(503) } finally { error.mockRestore() }
  })

  it('applies the same Studio gate', async () => {
    getProfile.mockResolvedValue({ ...profile, accounts: { plan: 'free' } })
    expect((await (await route()).GET()).status).toBe(403)
    expect((await (await route()).DELETE()).status).toBe(403)
  })
})
