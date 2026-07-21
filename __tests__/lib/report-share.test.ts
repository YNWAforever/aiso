import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  buildReportShareUrl,
  signReportShare,
  verifyReportShare,
} from '@/lib/reports/share'

const SECRET = '0123456789abcdef0123456789abcdef'
const SLUG = 'AbCdEfGhIjKlMnOpQrStUvWxYz012345'
const OTHER_SLUG = '0123456789abcdefghijklmnopqrstuv'

describe('report share signing', () => {
  beforeEach(() => vi.stubEnv('REPORT_SHARE_SECRET', SECRET))
  afterEach(() => vi.unstubAllEnvs())

  it('signs the exact versioned canonical slug and positive share version with HMAC-SHA-256 base64url', () => {
    const expected = createHmac('sha256', SECRET)
      .update(`fimmick-report:v1:${SLUG}:7`)
      .digest('base64url')

    expect(signReportShare({ slug: SLUG, shareVersion: 7 })).toBe(expected)
    expect(expected).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(verifyReportShare({ slug: SLUG, shareVersion: 7, signature: expected })).toBe(true)
  })

  it('rejects changed canonical data and equal-length signature changes without throwing', () => {
    const signature = signReportShare({ slug: SLUG, shareVersion: 3 })
    const replacement = signature.endsWith('A') ? 'B' : 'A'
    const changedSignature = signature.slice(0, -1) + replacement

    expect(verifyReportShare({ slug: OTHER_SLUG, shareVersion: 3, signature })).toBe(false)
    expect(verifyReportShare({ slug: SLUG, shareVersion: 4, signature })).toBe(false)
    expect(verifyReportShare({ slug: SLUG, shareVersion: 3, signature: changedSignature })).toBe(false)
  })

  it.each(['', 'abc', 'not+base64/url', 'A'.repeat(42), 'A'.repeat(44)])(
    'rejects malformed or unequal-length signature %j before comparison',
    signature => {
      expect(verifyReportShare({ slug: SLUG, shareVersion: 3, signature })).toBe(false)
    },
  )

  it.each([0, -1, 1.2, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects non-positive or non-integer share version %s',
    shareVersion => {
      expect(() => signReportShare({ slug: SLUG, shareVersion })).toThrow(/positive integer/i)
      expect(verifyReportShare({ slug: SLUG, shareVersion, signature: 'A'.repeat(43) })).toBe(false)
    },
  )

  it.each([undefined, 'short-secret-value'])('fails closed for a missing or short server secret', value => {
    if (value === undefined) vi.stubEnv('REPORT_SHARE_SECRET', undefined)
    else vi.stubEnv('REPORT_SHARE_SECRET', value)

    for (const operation of [
      () => signReportShare({ slug: SLUG, shareVersion: 1 }),
      () => verifyReportShare({ slug: SLUG, shareVersion: 1, signature: 'A'.repeat(43) }),
    ]) {
      let thrown: unknown
      try { operation() } catch (error) { thrown = error }
      expect(thrown).toBeInstanceOf(Error)
      expect(String(thrown)).toMatch(/REPORT_SHARE_SECRET.*32/i)
      if (value) expect(String(thrown)).not.toContain(value)
    }
  })

  it.each(['en', 'zh-HK'] as const)('builds a signed URL that preserves valid locale %s', locale => {
    const url = new URL(buildReportShareUrl({
      origin: 'https://reports.example',
      locale,
      slug: SLUG,
      shareVersion: 2,
    }))

    expect(url.origin).toBe('https://reports.example')
    expect(url.pathname).toBe(`/${locale}/reports/${SLUG}`)
    expect(url.searchParams.get('version')).toBe('2')
    expect(url.searchParams.get('signature')).toBe(signReportShare({ slug: SLUG, shareVersion: 2 }))
  })

  it.each(['EN', 'zh', 'zh-hk', 'en\r\nX-Test: injected'])('rejects invalid locale %j instead of reflecting it', locale => {
    expect(() => buildReportShareUrl({
      origin: 'https://reports.example',
      locale: locale as 'en',
      slug: SLUG,
      shareVersion: 1,
    })).toThrow(/locale/i)
  })

  it.each([
    '', 'short', 'A'.repeat(31), 'A'.repeat(33),
    '../' + 'A'.repeat(29), 'A'.repeat(16) + '/' + 'B'.repeat(15),
    'A'.repeat(16) + '.' + 'B'.repeat(15),
  ])('rejects non-database report slug %j', slug => {
    expect(() => signReportShare({ slug, shareVersion: 1 })).toThrow(/slug/i)
    expect(verifyReportShare({ slug, shareVersion: 1, signature: 'A'.repeat(43) })).toBe(false)
    expect(() => buildReportShareUrl({ origin: 'https://reports.example', locale: 'en', slug, shareVersion: 1 }))
      .toThrow(/slug/i)
  })

  it.each([
    'http://reports.example',
    'javascript:alert(1)',
    'data:text/plain,hello',
    'file:///etc/passwd',
    'https://user:password@reports.example',
    'https://reports.example/base',
    'https://reports.example?next=https://evil.example',
    'https://reports.example/#javascript:alert(1)',
    'https://reports.example\\@evil.example',
  ])('rejects hostile or non-origin base %s', origin => {
    expect(() => buildReportShareUrl({ origin, locale: 'en', slug: SLUG, shareVersion: 1 }))
      .toThrow(/origin/i)
  })
})
