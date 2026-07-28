import { describe, it, expect } from 'vitest'
import { isAllowlistedAdminEmail } from '@/lib/admin/allowlist'

describe('isAllowlistedAdminEmail', () => {
  const list = 'Owner@Example.com, second@example.com'

  it('matches case-insensitively', () => {
    expect(isAllowlistedAdminEmail('owner@example.com', true, list)).toBe(true)
    expect(isAllowlistedAdminEmail('OWNER@EXAMPLE.COM', true, list)).toBe(true)
  })

  it('ignores surrounding whitespace in both the list and the email', () => {
    expect(isAllowlistedAdminEmail('  second@example.com  ', true, list)).toBe(true)
  })

  it('rejects an email not on the list', () => {
    expect(isAllowlistedAdminEmail('nobody@example.com', true, list)).toBe(false)
  })

  it('rejects an unverified email even when listed', () => {
    expect(isAllowlistedAdminEmail('owner@example.com', false, list)).toBe(false)
  })

  it('grants nobody when the list is empty, blank, or undefined', () => {
    expect(isAllowlistedAdminEmail('owner@example.com', true, '')).toBe(false)
    expect(isAllowlistedAdminEmail('owner@example.com', true, '   ')).toBe(false)
    expect(isAllowlistedAdminEmail('owner@example.com', true, undefined)).toBe(false)
  })

  it('rejects a null or empty email', () => {
    expect(isAllowlistedAdminEmail(null, true, list)).toBe(false)
    expect(isAllowlistedAdminEmail('', true, list)).toBe(false)
  })

  it('ignores empty entries produced by trailing commas', () => {
    expect(isAllowlistedAdminEmail('', true, 'a@b.com,,')).toBe(false)
  })
})
