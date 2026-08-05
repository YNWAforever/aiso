import { describe, expect, it } from 'vitest'
import { getScanSubmitLabelKey, normalizeSubmittedUrl } from '@/components/home/ScanForm'

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
