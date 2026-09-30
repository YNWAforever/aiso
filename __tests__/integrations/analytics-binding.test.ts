import { describe, expect, it } from 'vitest'
import { streamEligibility, streamStillMatches } from '@/lib/integrations/analytics/binding'

describe('streamEligibility', () => {
  it.each([
    ['https://www.example.com', 'www.example.com'],
    ['https://example.com/', 'example.com'],
    ['http://example.com', 'example.com'],
    ['HTTPS://WWW.Example.COM/', 'www.example.com'],
  ])('%s is eligible for brand example.com with host %s', (uri, host) => {
    expect(streamEligibility(uri, 'example.com')).toEqual({ eligible: true, host })
  })

  it('normalises the brand domain before comparing', () => {
    expect(streamEligibility('https://example.com', 'https://www.Example.com/path')).toEqual({
      eligible: true,
      host: 'example.com',
    })
    expect(streamEligibility('https://www.example.com', 'www.example.com')).toEqual({
      eligible: true,
      host: 'www.example.com',
    })
  })

  it('refuses a sibling subdomain', () => {
    expect(streamEligibility('https://shop.example.com', 'example.com')).toEqual({
      eligible: false,
      reason: 'other_domain',
    })
  })

  it('refuses the apex for a subdomain brand', () => {
    expect(streamEligibility('https://example.com', 'shop.example.com')).toEqual({
      eligible: false,
      reason: 'other_domain',
    })
  })

  it('refuses a lookalike host', () => {
    expect(streamEligibility('https://notexample.com', 'example.com')).toEqual({
      eligible: false,
      reason: 'other_domain',
    })
    expect(streamEligibility('https://example.com.evil.example', 'example.com')).toEqual({
      eligible: false,
      reason: 'other_domain',
    })
  })

  it.each([
    'https://example.com:8443',
    'http://example.com:8080/',
    'ftp://example.com',
    'http://192.0.2.1',
    'https://[2001:db8::1]/',
    'not a url',
    '',
    'example.com',
  ])('%s is invalid_uri', uri => {
    expect(streamEligibility(uri, 'example.com')).toEqual({ eligible: false, reason: 'invalid_uri' })
  })

  it.each([null, undefined, '', 'localhost', '192.0.2.1'])('brand %s gives no_domain', brand => {
    expect(streamEligibility('https://example.com', brand)).toEqual({ eligible: false, reason: 'no_domain' })
  })
})

describe('streamStillMatches', () => {
  it('matches the stored host for the same brand', () => {
    expect(streamStillMatches('example.com', 'example.com')).toBe(true)
    expect(streamStillMatches('www.example.com', 'example.com')).toBe(true)
    expect(streamStillMatches('www.example.com', 'www.example.com')).toBe(true)
  })

  it('does not match once the brand domain has moved to a subdomain', () => {
    expect(streamStillMatches('www.example.com', 'shop.example.com')).toBe(false)
  })

  it('does not match another site', () => {
    expect(streamStillMatches('example.com', 'other.com')).toBe(false)
  })

  it('does not match with no brand domain', () => {
    expect(streamStillMatches('example.com', null)).toBe(false)
    expect(streamStillMatches('example.com', undefined)).toBe(false)
  })

  it('is case-insensitive on the stored host', () => {
    expect(streamStillMatches('WWW.Example.com', 'example.com')).toBe(true)
  })

  it.each(['example.com:8443', 'https://example.com', 'example.com/path', '192.0.2.1', ''])(
    'refuses a stored value that is not a bare host: %s',
    stored => {
      expect(streamStillMatches(stored, 'example.com')).toBe(false)
    },
  )
})
