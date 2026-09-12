import { describe, expect, it } from 'vitest'
import {
  INVITATION_TTL_MS,
  MAX_ACCOUNT_MEMBERS,
  deriveInvitationStatus,
  normalizeInvitationEmail,
  normalizeInvitationInput,
} from '@/lib/members/schema'

describe('normalizeInvitationEmail', () => {
  it('lowercases and trims so one address has one spelling', () => {
    expect(normalizeInvitationEmail('  Approver@Example.COM \t')).toBe('approver@example.com')
  })

  it('normalizes to NFC so a decomposed address cannot become a second row', () => {
    // U+0065 U+0301 (decomposed) must come back as U+00E9 (composed).
    expect(normalizeInvitationEmail('josé@example.com')).toBe('josé@example.com')
  })

  it.each([
    ['not a string', 42],
    ['empty', ''],
    ['whitespace only', '   '],
    ['no at sign', 'approver.example.com'],
    ['two at signs', 'a@b@example.com'],
    ['no dot in domain', 'approver@localhost'],
    ['inner whitespace', 'appro ver@example.com'],
    ['a control character', `approver${String.fromCharCode(7)}@example.com`],
    ['an inner newline', 'approver@exa\nmple.com'],
    ['over 254 characters', `${'a'.repeat(250)}@example.com`],
  ])('rejects %s', (_label, value) => {
    expect(() => normalizeInvitationEmail(value)).toThrow('INVALID_INVITATION_INPUT')
  })
})

describe('normalizeInvitationInput', () => {
  it('accepts an email and a supported locale', () => {
    expect(normalizeInvitationInput({ email: 'Approver@Example.com', locale: 'zh-HK' })).toEqual({
      email: 'approver@example.com',
      locale: 'zh-HK',
    })
  })

  it.each([
    ['a null body', null],
    ['an array', []],
    ['an unsupported locale', { email: 'a@b.com', locale: 'fr' }],
    ['a missing locale', { email: 'a@b.com' }],
    ['an unexpected extra key', { email: 'a@b.com', locale: 'en', isAdmin: true }],
  ])('rejects %s', (_label, value) => {
    expect(() => normalizeInvitationInput(value)).toThrow('INVALID_INVITATION_INPUT')
  })
})

describe('deriveInvitationStatus', () => {
  const now = Date.parse('2026-09-11T00:00:00Z')
  const live = {
    acceptedAt: null,
    revokedAt: null,
    expiresAt: new Date(now + INVITATION_TTL_MS).toISOString(),
    registered: false,
  }

  it('is pending while it is live and the address has never signed in', () => {
    expect(deriveInvitationStatus(live, now)).toBe('pending')
  })

  it('is accepted once a profile has consumed it', () => {
    expect(deriveInvitationStatus({ ...live, acceptedAt: '2026-09-10T00:00:00Z' }, now)).toBe('accepted')
  })

  it('is revoked when a member withdrew it', () => {
    expect(deriveInvitationStatus({ ...live, revokedAt: '2026-09-10T00:00:00Z' }, now)).toBe('revoked')
  })

  it('is expired once its deadline has passed', () => {
    expect(deriveInvitationStatus({ ...live, expiresAt: '2026-09-10T00:00:00Z' }, now)).toBe('expired')
  })

  /**
   * The case that would otherwise read as "pending" forever. An invitation is
   * consumed at provisioning time, which only happens on a FIRST sign-in — so an
   * address that already has an auth user can never consume one. Showing that as
   * pending would tell the inviter to keep waiting for something that cannot
   * arrive.
   */
  it('is unclaimable when the address already has an account, not pending', () => {
    expect(deriveInvitationStatus({ ...live, registered: true }, now)).toBe('unclaimable')
  })

  it('reports accepted rather than unclaimable, since the consumer is itself registered', () => {
    expect(
      deriveInvitationStatus({ ...live, acceptedAt: '2026-09-10T00:00:00Z', registered: true }, now),
    ).toBe('accepted')
  })

  it('reports revoked rather than expired when both are true', () => {
    expect(
      deriveInvitationStatus(
        { ...live, revokedAt: '2026-09-10T00:00:00Z', expiresAt: '2026-09-10T00:00:00Z' },
        now,
      ),
    ).toBe('revoked')
  })
})

describe('limits', () => {
  it('caps members per account, because an invitation sends mail to an arbitrary address', () => {
    expect(MAX_ACCOUNT_MEMBERS).toBeGreaterThan(1)
    expect(MAX_ACCOUNT_MEMBERS).toBeLessThanOrEqual(25)
  })

  it('expires an invitation within a week', () => {
    expect(INVITATION_TTL_MS).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000)
  })
})
