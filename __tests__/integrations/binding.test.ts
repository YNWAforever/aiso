import { describe, expect, it } from 'vitest'
import { normalizeBrandDomain, propertyEligibility } from '@/lib/integrations/search-console/binding'

describe('normalizeBrandDomain', () => {
  it.each([
    ['Example.COM', 'example.com'],
    ['https://www.example.com/path?q=1', 'example.com'],
    ['www.example.com', 'example.com'],
    ['shop.example.com', 'shop.example.com'],
    ['  example.com  ', 'example.com'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizeBrandDomain(input)).toBe(expected)
  })

  it.each([null, '', 'localhost', 'not a domain'])('rejects %s', input => {
    expect(normalizeBrandDomain(input)).toBeNull()
  })
})

describe('propertyEligibility', () => {
  const owner = 'siteOwner'

  it.each([
    'sc-domain:example.com', 'https://example.com/', 'http://example.com/',
    'https://www.example.com/', 'http://www.example.com/',
  ])('%s covers example.com', site => {
    expect(propertyEligibility(site, owner, 'example.com')).toEqual({ eligible: true })
  })

  it('lets a Domain property cover a subdomain brand', () => {
    expect(propertyEligibility('sc-domain:example.com', owner, 'shop.example.com')).toEqual({ eligible: true })
  })

  it('does not let a URL-prefix property on one host cover another', () => {
    expect(propertyEligibility('https://blog.example.com/', owner, 'example.com'))
      .toEqual({ eligible: false, reason: 'other_domain' })
  })

  it('refuses a lookalike that merely ends with the domain', () => {
    expect(propertyEligibility('sc-domain:badexample.com', owner, 'example.com'))
      .toEqual({ eligible: false, reason: 'other_domain' })
  })

  it('refuses a URL-prefix property scoped to a path', () => {
    expect(propertyEligibility('https://example.com/blog/', owner, 'example.com'))
      .toEqual({ eligible: false, reason: 'other_domain' })
  })

  it('refuses a URL-prefix property pinned to an explicit non-default port', () => {
    expect(propertyEligibility('https://example.com:8080/', owner, 'example.com'))
      .toEqual({ eligible: false, reason: 'other_domain' })
  })

  it('accepts a URL-prefix property with the explicit default port', () => {
    expect(propertyEligibility('https://example.com:443/', owner, 'example.com'))
      .toEqual({ eligible: true })
  })

  it('refuses unverified access even on the right property', () => {
    expect(propertyEligibility('sc-domain:example.com', 'siteUnverifiedUser', 'example.com'))
      .toEqual({ eligible: false, reason: 'unverified' })
  })

  it.each(['siteOwner', 'siteFullUser', 'siteRestrictedUser'])('accepts %s', level => {
    expect(propertyEligibility('sc-domain:example.com', level, 'example.com')).toEqual({ eligible: true })
  })

  it('refuses a brand with no domain', () => {
    expect(propertyEligibility('sc-domain:example.com', owner, null)).toEqual({ eligible: false, reason: 'no_domain' })
  })
})
