import { describe, expect, it } from 'vitest'
import { bindingMatchesDomain, normalizeBrandDomain, propertyEligibility } from '@/lib/integrations/search-console/binding'

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

  it('rejects an IP literal', () => {
    expect(normalizeBrandDomain('192.168.1.1')).toBeNull()
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

  it('does not let a www Domain property cover the apex', () => {
    expect(propertyEligibility('sc-domain:www.example.com', owner, 'example.com'))
      .toEqual({ eligible: false, reason: 'other_domain' })
  })

  it('does not let a www Domain property cover a sibling subdomain', () => {
    expect(propertyEligibility('sc-domain:www.example.com', owner, 'shop.example.com'))
      .toEqual({ eligible: false, reason: 'other_domain' })
  })

  it('lets a www Domain property cover the same www host', () => {
    expect(propertyEligibility('sc-domain:www.example.com', owner, 'www.example.com')).toEqual({ eligible: true })
  })

  it('still lets an apex Domain property cover the www host', () => {
    expect(propertyEligibility('sc-domain:example.com', owner, 'www.example.com')).toEqual({ eligible: true })
  })

  it('refuses a brand that is an IP literal', () => {
    expect(propertyEligibility('https://192.168.1.1/', owner, '192.168.1.1'))
      .toEqual({ eligible: false, reason: 'no_domain' })
  })
})

describe('bindingMatchesDomain', () => {
  const bound = { siteUrl: 'sc-domain:example.com', permissionLevel: 'siteOwner', boundDomain: 'example.com' }

  it('matches while the brand keeps the domain it was bound for', () => {
    expect(bindingMatchesDomain(bound, 'example.com')).toBe(true)
    expect(bindingMatchesDomain(bound, 'https://www.example.com/')).toBe(true)
  })

  it('does not match once the brand domain changed', () => {
    expect(bindingMatchesDomain(bound, 'other.com')).toBe(false)
    expect(bindingMatchesDomain(bound, null)).toBe(false)
  })

  // bound_domain is www-stripped, so comparing it alone says www.example.com and
  // example.com are the same brand. A Domain property for the www host does
  // not cover the apex, so the property itself must be re-checked.
  it('does not match a www Domain property once the brand moves to the apex', () => {
    const www = { siteUrl: 'sc-domain:www.example.com', permissionLevel: 'siteOwner', boundDomain: 'example.com' }
    expect(bindingMatchesDomain(www, 'www.example.com')).toBe(true)
    expect(bindingMatchesDomain(www, 'example.com')).toBe(false)
  })
})
