import { describe, expect, it } from 'vitest'
import { getScanResultId, getScanErrorKey, getScanSubmitLabelKey, normalizeSubmittedUrl } from '@/components/home/ScanForm'

describe('normalizeSubmittedUrl', () => {
  it('trims a URL and adds https when the protocol is omitted', () => {
    expect(normalizeSubmittedUrl('  example.com/path  ')).toBe('https://example.com/path')
  })

  it('preserves an explicit http protocol', () => {
    expect(normalizeSubmittedUrl('http://example.com')).toBe('http://example.com/')
  })

  it('rejects an empty URL', () => {
    expect(() => normalizeSubmittedUrl('   ')).toThrowError('empty_url')
  })

  it('rejects malformed URLs', () => {
    expect(() => normalizeSubmittedUrl('http://')).toThrow()
  })

  it('rejects a non-web URL scheme', () => {
    expect(() => normalizeSubmittedUrl('mailto:user@example.com')).toThrowError('invalid_protocol')
  })
})

describe('scan form retry label', () => {
  it('switches to the localized retry key after a scan failure', () => {
    expect(getScanSubmitLabelKey(false)).toBe('cta')
    expect(getScanSubmitLabelKey(true)).toBe('retry_scan')
  })
})

describe('safe localized scan failures', () => {
  it.each([
    [503, 'Authentication service unavailable', 'scan_auth_unavailable'],
    [503, 'Public scan temporarily unavailable', 'scan_unavailable'],
    [503, 'Authenticated scan quota unavailable', 'scan_quota_unavailable'],
    [403, 'AUTHENTICATED_SCAN_UPGRADE_REQUIRED', 'scan_upgrade_required'],
    [429, 'AUTHENTICATED_SCAN_LIMIT_REACHED', 'scan_quota_reached'],
    [429, 'Too many scan requests. Please try again later.', 'scan_rate_limited'],
    [500, 'Database error — check Neon configuration', 'scan_save_failed'],
    [500, 'Insert returned no data', 'scan_save_failed'],
    [500, 'private infrastructure secret', 'scan_error_action'],
    [503, 'unknown private error', 'scan_unavailable'],
    [400, 'Invalid URL', 'url_invalid'],
    [400, 'Invalid URL format', 'url_invalid'],
    [400, 'URL must use HTTP or HTTPS without credentials', 'url_invalid'],
    [400, 'URL must resolve to a public HTTP or HTTPS address', 'url_invalid'],
    [400, 'Invalid JSON body', 'scan_error_action'],
    [400, 'unknown private message', 'scan_error_action'],
  ])('maps %s / %s to %s', (status, error, key) => {
    expect(getScanErrorKey(Number(status), { error })).toBe(key)
  })
  it('ignores arbitrary response payloads and mismatched status codes', () => {
    expect(getScanErrorKey(500, null)).toBe('scan_error_action')
    expect(getScanErrorKey(500, { error: 'AUTHENTICATED_SCAN_LIMIT_REACHED' })).toBe('scan_error_action')
  })
})

describe('validated scan result identity', () => {
  it.each(['', '../methodology', 'not-an-id', 12, null, undefined])('rejects invalid response id %s', id => {
    expect(() => getScanResultId({ id })).toThrow('invalid_response')
  })
  it('preserves a valid stored scan UUID', () => {
    const id = 'e2e00000-0000-4000-a000-000000000001'
    expect(getScanResultId({ id })).toBe(id)
  })
})
