import { describe, expect, it } from 'vitest'
import { normalizeSubmittedUrl } from '@/components/home/ScanForm'

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
