import { createHmac } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))

import {
  buildReportShareUrl,
  signReportShare,
  verifyReportShare,
} from '@/lib/reports/share'

const SECRET = '0123456789abcdef0123456789abcdef'

describe('report share signing', () => {
  beforeEach(() => vi.stubEnv('REPORT_SHARE_SECRET', SECRET))
  afterEach(() => vi.unstubAllEnvs())

  it('signs the exact versioned canonical slug and positive share version with HMAC-SHA-256 base64url', () => {
    const expected = createHmac('sha256', SECRET)
      .update('fimmick-report:v1:client/acme:7')
      .digest('base64url')

    expect(signReportShare({ slug: 'client/acme', shareVersion: 7 })).toBe(expected)
    expect(expected).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(verifyReportShare({ slug: 'client/acme', shareVersion: 7, signature: expected })).toBe(true)
  })

  it('rejects changed canonical data and equal-length signature changes without throwing', () => {
    const signature = signReportShare({ slug: 'client-acme', shareVersion: 3 })
    const replacement = signature.endsWith('A') ? 'B' : 'A'
    const changedSignature = signature.slice(0, -1) + replacement

    expect(verifyReportShare({ slug: 'other-client', shareVersion: 3, signature })).toBe(false)
    expect(verifyReportShare({ slug: 'client-acme', shareVersion: 4, signature })).toBe(false)
    expect(verifyReportShare({ slug: 'client-acme', shareVersion: 3, signature: changedSignature })).toBe(false)
  })

  it.each(['', 'abc', 'not+base64/url', 'A'.repeat(42), 'A'.repeat(44)])(
    'rejects malformed or unequal-length signature %j before comparison',
    signature => {
      expect(verifyReportShare({ slug: 'client-acme', shareVersion: 3, signature })).toBe(false)
    },
  )

  it.each([0, -1, 1.2, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects non-positive or non-integer share version %s',
    shareVersion => {
      expect(() => signReportShare({ slug: 'client', shareVersion })).toThrow(/positive integer/i)
      expect(verifyReportShare({ slug: 'client', shareVersion, signature: 'A'.repeat(43) })).toBe(false)
    },
  )

  it.each([undefined, 'short-secret-value'])('fails closed for a missing or short server secret', value => {
    if (value === undefined) vi.stubEnv('REPORT_SHARE_SECRET', undefined)
    else vi.stubEnv('REPORT_SHARE_SECRET', value)

    for (const operation of [
      () => signReportShare({ slug: 'client', shareVersion: 1 }),
      () => verifyReportShare({ slug: 'client', shareVersion: 1, signature: 'A'.repeat(43) }),
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
      origin: 'https://reports.example/base',
      locale,
      slug: 'Acme & Sons/香港',
      shareVersion: 2,
    }))

    expect(url.origin).toBe('https://reports.example')
    expect(decodeURIComponent(url.pathname)).toBe(`/${locale}/reports/Acme & Sons/香港`)
    expect(url.searchParams.get('version')).toBe('2')
    expect(url.searchParams.get('signature')).toBe(signReportShare({ slug: 'Acme & Sons/香港', shareVersion: 2 }))
  })

  it.each(['EN', 'zh', 'zh-hk', 'en\r\nX-Test: injected'])('rejects invalid locale %j instead of reflecting it', locale => {
    expect(() => buildReportShareUrl({
      origin: 'https://reports.example',
      locale: locale as 'en',
      slug: 'client',
      shareVersion: 1,
    })).toThrow(/locale/i)
  })
})
