import { beforeEach, describe, expect, it } from 'vitest'
import { CONSENT_TTL_MS, signConsentState, verifyConsentState } from '@/lib/integrations/google/consent-state'

const input = {
  state: 'a'.repeat(43),
  verifier: 'v'.repeat(64),
  profileId: '11111111-1111-4111-8111-111111111111',
  accountId: '22222222-2222-4222-8222-222222222222',
  returnPath: '/en/dashboard/settings',
}

describe('consent state cookie', () => {
  beforeEach(() => { process.env.REPORT_SHARE_SECRET = 'consent-state-test-secret-0123456789abcdef' })

  it('round-trips within its lifetime', () => {
    const now = 1_000_000
    expect(verifyConsentState(signConsentState(input, now), now + 60_000)).toMatchObject(input)
  })

  it('expires after ten minutes', () => {
    const now = 1_000_000
    expect(verifyConsentState(signConsentState(input, now), now + 10 * 60_000 + 1)).toBeNull()
  })

  it('rejects a tampered payload', () => {
    const [payload, sig] = signConsentState(input).split('.')
    const forged = Buffer.from(JSON.stringify({
      ...JSON.parse(Buffer.from(payload!, 'base64url').toString()),
      accountId: '33333333-3333-4333-8333-333333333333',
    })).toString('base64url')
    expect(verifyConsentState(`${forged}.${sig}`)).toBeNull()
  })

  it('rejects an absent cookie', () => {
    expect(verifyConsentState(undefined)).toBeNull()
  })

  it.each(['//evil.example/x', 'https://evil.example/', '/en/result/abc', '/fr/dashboard'])(
    'refuses to sign a return path of %s', returnPath => {
      expect(() => signConsentState({ ...input, returnPath })).toThrow()
    })

  it('accepts a brand dashboard return path', () => {
    const returnPath = '/zh-HK/dashboard/22222222-2222-4222-8222-222222222222/assets'
    expect(verifyConsentState(signConsentState({ ...input, returnPath }))?.returnPath).toBe(returnPath)
  })

  it('expires exactly at the TTL boundary', () => {
    const now = 1_000_000
    expect(verifyConsentState(signConsentState(input, now), now + CONSENT_TTL_MS)).toBeNull()
  })

  it('rejects a token with three dot-separated segments', () => {
    const token = signConsentState(input)
    expect(verifyConsentState(`${token}.extra`)).toBeNull()
  })

  it('rejects a signature containing an invalid character', () => {
    const [payload] = signConsentState(input).split('.')
    const badSignature = `!${'a'.repeat(42)}`
    expect(verifyConsentState(`${payload}.${badSignature}`)).toBeNull()
  })

  it('refuses to sign a state containing a colon', () => {
    expect(() => signConsentState({ ...input, state: `${'a'.repeat(41)}:` })).toThrow()
  })

  it('refuses to sign a non-UUID accountId', () => {
    expect(() => signConsentState({ ...input, accountId: 'not-a-uuid' })).toThrow()
  })

  it('rejects a payload whose colon-joined fields were rewritten across the state/verifier boundary', () => {
    const colonInput = { ...input, state: 'A'.repeat(40), verifier: 'B'.repeat(50) }
    const [payload, sig] = signConsentState(colonInput).split('.')
    const original = JSON.parse(Buffer.from(payload!, 'base64url').toString())
    const forged = Buffer.from(JSON.stringify({
      ...original,
      state: 'A'.repeat(41),
      verifier: 'B'.repeat(49),
    })).toString('base64url')
    expect(verifyConsentState(`${forged}.${sig}`)).toBeNull()
  })
})
